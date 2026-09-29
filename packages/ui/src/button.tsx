// Adapted from shadcn/ui's MIT-licensed Base UI button. See NOTICE.md.
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";
const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "ui-button-primary",
      ghost: "ui-button-ghost",
      destructive: "ui-button-destructive",
      outline: "ui-button-outline",
    },
    size: { default: "ui-button-default", sm: "ui-button-small", icon: "ui-button-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
