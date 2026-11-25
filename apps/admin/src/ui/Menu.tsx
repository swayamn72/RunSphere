import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';

/**
 * A menu button with keyboard navigation, typeahead, focus return and
 * Escape-to-close, from Radix's unstyled primitive. Only the look is ours
 * (`.rs-menu*` in `ui.css`, from `@runsphere/ui` variables).
 */
export function Menu({
  label,
  trigger,
  children,
  align = 'start'
}: {
  /** The trigger's accessible name when its visible content is not enough. */
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="rs-menu-trigger" aria-label={label}>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="rs-menu" align={align} side="top" sideOffset={8}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="rs-menu__label">{children}</DropdownMenu.Label>;
}

export function MenuItem({
  onSelect,
  danger = false,
  children
}: {
  onSelect: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Item
      className={danger ? 'rs-menu__item rs-menu__item--danger' : 'rs-menu__item'}
      onSelect={onSelect}
    >
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuRadioGroup<T extends string>({
  value,
  onChange,
  options
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
      {options.map((option) => (
        <DropdownMenu.RadioItem
          key={option.value}
          value={option.value}
          className="rs-menu__item rs-menu__item--radio"
        >
          <DropdownMenu.ItemIndicator className="rs-menu__check" aria-hidden>
            ✓
          </DropdownMenu.ItemIndicator>
          {option.label}
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="rs-menu__separator" />;
}
