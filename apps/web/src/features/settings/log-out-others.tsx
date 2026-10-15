import { useState } from "react";
import { Button } from "@/components/button";
import { logOutOthers as logOutOthersOnWorker } from "../../api/worker.ts";
import { describeProblem } from "../../components/problems.tsx";

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
      <Button variant="destructive" onClick={logOutOthers}>
        Log out all other devices
      </Button>
      {message && (
        <p role="status" className="mt-3">
          {message}
        </p>
      )}
    </div>
  );
}
