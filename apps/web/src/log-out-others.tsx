import { useState } from "react";
import { describeProblem } from "./problems.tsx";
import { logOutOthers as logOutOthersOnWorker } from "./worker.ts";

/** Ends every other device's login, for when a phone or laptop is lost. */
export function LogOutOthers() {
  const [message, setMessage] = useState<string>();

  const logOutOthers = async () => {
    const result = await logOutOthersOnWorker();
    setMessage(
      result.kind === "loaded" ? "Every other device is logged out." : describeProblem(result).body,
    );
  };

  return (
    <div className="mt-12 border-t pt-6 text-sm text-muted-foreground">
      {/* A plain button: shadcn's Button would put its class-merging code on the first load. */}
      <button
        type="button"
        onClick={logOutOthers}
        className="h-9 rounded-full bg-destructive/10 px-5 text-sm font-semibold text-destructive-text hover:bg-destructive/20"
      >
        Log out all other devices
      </button>
      {message && (
        <p role="status" className="mt-3">
          {message}
        </p>
      )}
    </div>
  );
}
