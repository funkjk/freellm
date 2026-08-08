import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearApiKey, getApiKey, setApiKey, subscribeApiKey } from "@/lib/api-key";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

function useStoredApiKey(): string | null {
  return useSyncExternalStore(subscribeApiKey, getApiKey, () => null);
}

/**
 * Compact header control: paste FREELLM_API_KEY or FREELLM_ADMIN_KEY so
 * dashboard fetches can authenticate against a locked-down gateway.
 */
export function ApiKeyControl({ compact = false }: { compact?: boolean }) {
  const stored = useStoredApiKey();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();

  const save = () => {
    if (!draft.trim()) {
      toast.error("Enter an API key");
      return;
    }
    setApiKey(draft);
    setDraft("");
    setEditing(false);
    queryClient.invalidateQueries();
    toast.success("API key saved for this session");
  };

  const clear = () => {
    clearApiKey();
    setDraft("");
    setEditing(false);
    queryClient.invalidateQueries();
    toast.message("API key cleared");
  };

  if (stored && !editing) {
    return (
      <div className="flex items-center gap-1.5">
        <div
          className={
            compact
              ? "flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20 text-[10px] font-mono text-primary"
              : "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs font-mono text-primary"
          }
          title="API key set for this browser session"
        >
          <KeyRound className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />
          <span>Key set</span>
        </div>
        <button
          type="button"
          onClick={clear}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors cursor-pointer"
          title="Clear API key"
          aria-label="Clear API key"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (compact && !editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        title="Set API key"
      >
        <KeyRound className="w-3 h-3" />
        Key
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="API key"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className={
          compact
            ? "h-7 w-36 text-[11px] font-mono bg-white/[0.03] border-white/[0.08]"
            : "h-8 w-44 text-xs font-mono bg-white/[0.03] border-white/[0.08]"
        }
        aria-label="Gateway API key"
      />
      <Button
        type="submit"
        size="sm"
        className={compact ? "h-7 px-2 text-[11px]" : "h-8 px-3 text-xs"}
      >
        Save
      </Button>
      {editing && (
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setDraft("");
          }}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
          aria-label="Cancel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </form>
  );
}
