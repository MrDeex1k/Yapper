import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
const buttonVariants = cva('inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 disabled:pointer-events-none', {variants:{variant:{default:'bg-primary text-primary-foreground hover:bg-primary/90',outline:'border border-border bg-transparent hover:bg-muted',ghost:'hover:bg-muted'},size:{default:'h-10 px-4',sm:'h-8 px-3'}},defaultVariants:{variant:'default',size:'default'}});
export function Button({className,variant,size,...props}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({variant,size,className}))} {...props}/>;}
