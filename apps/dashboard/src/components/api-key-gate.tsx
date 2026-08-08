import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setApiKey } from "@/lib/api-key";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Full-width prompt shown when status/models calls fail with an auth error.
 */
export function ApiKeyGate({
  title = "API key required",
  description = "This gateway requires Authorization. Enter FREELLM_API_KEY or FREELLM_ADMIN_KEY to load the dashboard.",
}: {
  title?: string;
  description?: string;
}) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-2 rounded-lg bg-amber-500/10 text-amber-400">
          <KeyRound className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-mono font-semibold text-base">{title}</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">{description}</p>
        </div>
      </div>
      <form
        className="flex flex-col sm:flex-row gap-2 max-w-lg"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) {
            toast.error("Enter an API key");
            return;
          }
          setApiKey(draft);
          setDraft("");
          queryClient.invalidateQueries();
          toast.success("API key saved for this session");
        }}
      >
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Bearer key…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="font-mono text-sm bg-background/50"
          aria-label="Gateway API key"
        />
        <Button type="submit" className="shrink-0">
          Connect
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Stored in sessionStorage for this tab only — cleared when the tab closes.
      </p>
    </div>
  );
}
