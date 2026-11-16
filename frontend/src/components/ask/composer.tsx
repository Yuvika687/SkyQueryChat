"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useOpenDataPanel } from "@/components/shell/app-shell";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComposerHandle {
  focus: () => void;
  setText: (t: string) => void;
}

interface Props {
  busy: boolean;
  onSend: (q: string) => void;
  onStop: () => void;
  placeholder: string;
}

const MAX = 500; // backend limit (ChatRequest.message)

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ busy, onSend, onStop, placeholder }, ref) {
  const [text, setText] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const openData = useOpenDataPanel();
  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus(), setText: (t) => setText(t.slice(0, MAX)) }));

  const submit = () => {
    const q = text.trim();
    if (!q || busy) return;
    onSend(q);
    setText("");
  };

  return (
    <div className="bg-background px-4 pt-2 pb-3">
      <form
        className="mx-auto flex w-full max-w-[760px] flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="card flex items-end gap-2 rounded-2xl p-2 focus-within:border-teal/70">
          <label htmlFor="question" className="sr-only">Your question</label>
          <textarea
            id="question"
            ref={ta}
            rows={1}
            value={text}
            maxLength={MAX}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 [field-sizing:content] placeholder:text-subtle focus:outline-none sm:text-sm"
          />
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium hover:border-danger hover:text-danger"
            >
              <Square className="size-3.5 fill-current" aria-hidden />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!text.trim()}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-teal px-3 text-sm font-medium text-background hover:bg-teal-hover disabled:bg-raised disabled:text-subtle",
              )}
            >
              <ArrowUp className="size-4" aria-hidden />
              <span className="hidden sm:inline">Send</span>
            </button>
          )}
        </div>
        <p className="flex justify-between gap-2 px-1 text-[12px] leading-4 text-faint">
          <span>
            Latest available data, which may have gaps ·{" "}
            <button type="button" onClick={openData} className="underline underline-offset-2 hover:text-foreground">Sources</button>
          </span>
          {text.length > MAX - 60 && <span className="num">{text.length}/{MAX}</span>}
        </p>
      </form>
    </div>
  );
});
