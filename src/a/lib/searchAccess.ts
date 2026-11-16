/** Whether Find a piece is open to this visitor (src/core/catalogueSearch.ts), asked once per tab. */
import { useEffect, useState } from "react";
import { searchAvailable } from "../../core/catalogueSearch";

let asked: Promise<"everyone" | "test" | null> | null = null;

/** undefined while the server is being asked; then "everyone", "test" or null. */
export function useSearchAccess(): "everyone" | "test" | null | undefined {
  const [access, setAccess] = useState<"everyone" | "test" | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    asked ??= searchAvailable();
    void asked.then((a) => {
      if (live) setAccess(a);
    });
    return () => {
      live = false;
    };
  }, []);
  return access;
}
