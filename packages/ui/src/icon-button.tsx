import { Tooltip } from "@base-ui/react/tooltip";
import type { ComponentProps } from "react";
import { Button } from "./button";

export const TooltipProvider = Tooltip.Provider;

export function IconButton({
  label,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "aria-label" | "size"> & { label: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<Button {...props} size="icon" />}
        aria-label={label}
        disabled={props.disabled}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={7} className="ui-tooltip-positioner">
          <Tooltip.Popup className="ui-tooltip">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
