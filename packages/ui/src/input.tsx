import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "./utils";
export function Input({ className, ...props }: InputPrimitive.Props) {
  return <InputPrimitive data-slot="input" className={cn("ui-input", className)} {...props} />;
}
