import { useState } from "react";
import { describeProblem } from "./problems.tsx";
import { toWorker } from "./worker.ts";

/** Ends every other device's login, for when a phone or laptop is lost. */
export function LogOutOthers() {
  const [message, setMessage] = useState<string>();

  const logOutOthers = async () => {
    const result = await toWorker("/logout-others", {});
    setMessage(
      result.kind === "loaded" ? "Every other device is logged out." : describeProblem(result).body,
    );
  };

  return (
    <div className="mt-10 border-t border-neutral-200 pt-4 text-sm text-neutral-600">
      <button type="button" onClick={logOutOthers} className="underline hover:text-neutral-900">
        Log out all other devices
      </button>
      {message && (
        <p role="status" className="mt-2">
          {message}
        </p>
      )}
    </div>
  );
}
