import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-40 w-full rounded-[24px] border border-black/[0.07] bg-white/75 px-4 py-4 text-sm leading-7 text-[#171b24] shadow-sm outline-none transition placeholder:text-[#9aa1ad] focus:border-[#9caaff] focus:ring-4 focus:ring-[#9caaff]/15",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
