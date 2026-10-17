import {
  createServer,
  request as forward,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from "node:http";
import { createServer as createNetServer, type Socket } from "node:net";
import { LOGIN_COOKIE } from "../../auth/owner/routes.ts";

/**
 * A preview's own port (#183): everything that comes to it is the owner's, logged in, or it's
 * refused; the rest goes to the app on the worker machine's localhost, page requests and live
 * reload (a WebSocket) alike, as if the browser had asked the app itself.
 */
export type PreviewPort = {
  readonly port: number;
  /** The app's own cookies the owner's browser last sent it, for screenshots taken as they see it. */
  readonly cookies: () => string | undefined;
  readonly close: () => void;
};

/**
 * What the app's own login cookie is called in the owner's browser, when the app names one as
 * Courtyard's is (a preview of Courtyard itself): cookies are shared by every port on an address,
 * so the app's would otherwise log the owner out of Courtyard.
 */
const APPS_LOGIN_COOKIE = `${LOGIN_COOKIE}_preview`;

/**
 * The cookies the app is sent: none of Courtyard's, which never leave the worker, and its own
 * login by its own name again.
 */
const appCookies = (header: string | undefined) => {
  const kept = (header ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair !== "" && !pair.startsWith(`${LOGIN_COOKIE}=`))
    .map((pair) =>
      pair.startsWith(`${APPS_LOGIN_COOKIE}=`)
        ? `${LOGIN_COOKIE}=${pair.slice(APPS_LOGIN_COOKIE.length + 1)}`
        : pair,
    );
  return kept.length === 0 ? undefined : kept.join("; ");
};

/** A cookie the app sets, as the owner's browser is given it: its login under its own name. */
const asSet = (cookie: string) =>
  cookie.startsWith(`${LOGIN_COOKIE}=`)
    ? `${APPS_LOGIN_COOKIE}${cookie.slice(LOGIN_COOKIE.length)}`
    : cookie;

/** A request's headers as the app is sent them: for its own address, with only its own cookies. */
const headersFor = (headers: IncomingHttpHeaders, app: number) => {
  const { cookie: _cookie, host: _host, ...rest } = headers;
  const cookies = appCookies(headers.cookie);
  return {
    ...rest,
    host: `localhost:${app}`,
    ...(cookies === undefined ? {} : { cookie: cookies }),
  };
};

/** A response's headers as the owner's browser is given them, its cookies' names kept apart. */
const headersBack = (headers: IncomingHttpHeaders) => {
  const setCookie = headers["set-cookie"];
  return setCookie === undefined ? headers : { ...headers, "set-cookie": setCookie.map(asSet) };
};

/** What a browser that isn't logged in is told. */
const LOG_IN_FIRST = "Log in to Courtyard first, then open the preview from its session.";

/** A response's head as raw HTTP, for an upgrade: its status line and each header. */
const rawHead = (response: IncomingMessage) => {
  const headers = headersBack(response.headers);
  const lines = Object.entries(headers).flatMap(([name, value]) =>
    value === undefined
      ? []
      : (Array.isArray(value) ? value : [value]).map((one) => `${name}: ${one}`),
  );
  return `HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? ""}\r\n${lines.join("\r\n")}\r\n\r\n`;
};

/** Listens on `port` (0 for any free one): the port it got, or `undefined` when it's in use. */
const listen = (server: Server, port: number) =>
  new Promise<number | undefined>((resolve) => {
    const failed = () => resolve(undefined);
    server.once("error", failed);
    server.listen(port, () => {
      server.off("error", failed);
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : undefined);
    });
  });

/**
 * Opens a preview's port in front of the app serving on localhost's `app` port: the first of
 * `ports` free on the machine, or `undefined` when none is.
 */
export const openPreviewPort = async (open: {
  ports: readonly number[];
  app: number;
  loggedIn: (cookies: string | undefined) => Promise<boolean>;
}): Promise<PreviewPort | undefined> => {
  const { app, loggedIn } = open;
  let cookies: string | undefined;
  const sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    if (!(await loggedIn(request.headers.cookie))) {
      response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
      response.end(LOG_IN_FIRST);
      return;
    }
    cookies = appCookies(request.headers.cookie);
    const onward = forward(
      {
        host: "localhost",
        port: app,
        method: request.method,
        path: request.url,
        headers: headersFor(request.headers, app),
      },
      (answer) => {
        response.writeHead(
          answer.statusCode ?? 502,
          answer.statusMessage,
          headersBack(answer.headers),
        );
        answer.pipe(response);
      },
    );
    onward.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end("The app isn't answering.");
    });
    request.pipe(onward);
  });
  // Live reload: the browser's WebSocket goes through to the app.
  server.on("upgrade", async (request: IncomingMessage, socket: Socket, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    if (!(await loggedIn(request.headers.cookie))) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const onward = forward({
      host: "localhost",
      port: app,
      method: request.method,
      path: request.url,
      headers: headersFor(request.headers, app),
    });
    onward.on("upgrade", (answer, appSocket, appHead) => {
      appSocket.on("error", () => socket.destroy());
      // Either side gone, the other goes too.
      appSocket.on("close", () => socket.destroy());
      socket.on("close", () => appSocket.destroy());
      socket.write(rawHead(answer));
      if (appHead.length > 0) socket.write(appHead);
      if (head.length > 0) appSocket.write(head);
      appSocket.pipe(socket);
      socket.pipe(appSocket);
      sockets.add(appSocket);
    });
    onward.on("response", (answer) => {
      socket.end(rawHead(answer));
    });
    onward.on("error", () => socket.destroy());
    onward.end();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  for (const port of open.ports) {
    const got = await listen(server, port);
    if (got === undefined) continue;
    // Never keeps the worker alive on its own.
    server.unref();
    return {
      port: got,
      cookies: () => cookies,
      close: () => {
        server.close();
        for (const socket of sockets) socket.destroy();
      },
    };
  }
  return undefined;
};

/** A port free on the machine now, for an app to serve on (its `PORT`). */
export const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "localhost", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
