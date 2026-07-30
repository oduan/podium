import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function iconProps(props: IconProps): IconProps {
  return {
    viewBox: "0 0 20 20",
    fill: "none",
    "aria-hidden": true,
    className: "icon",
    ...props,
  };
}

export function PodiumIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 15.5V9.25M10 15.5V4.5M16 15.5V7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="8.5" cy="8.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m12 12 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="10" cy="10" r="2.7" stroke="currentColor" strokeWidth="1.4" />
      <path d="m15.4 11.1 1.1.8-1.4 2.5-1.3-.5a6 6 0 0 1-1.7 1l-.2 1.4H9.1l-.2-1.4a6 6 0 0 1-1.7-1l-1.3.5-1.4-2.5 1.1-.8a6 6 0 0 1 0-2.2l-1.1-.8 1.4-2.5 1.3.5a6 6 0 0 1 1.7-1l.2-1.4h2.8l.2 1.4a6 6 0 0 1 1.7 1l1.3-.5 1.4 2.5-1.1.8a6 6 0 0 1 0 2.2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function SignOutIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8m4.5-9.5L16 10l-3.5 3.5M16 10H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 6h12M4 10h12M4 14h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function PanelIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M5 4h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12 4v12M6.5 7.5h3M6.5 10h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 8.4v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="5.8" r=".9" fill="currentColor" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="m6 6 8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M2.75 6.25h5l1.5 1.5h8v6.5a1.5 1.5 0 0 1-1.5 1.5h-11a1.5 1.5 0 0 1-1.5-1.5v-8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M2.75 7.75v-2a1.5 1.5 0 0 1 1.5-1.5H7l1.5 2h7.25a1.5 1.5 0 0 1 1.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="m7.2 10.8 4.6-4.6a2.3 2.3 0 0 1 3.2 3.2l-6 6a3.7 3.7 0 0 1-5.2-5.2l6.1-6.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="m5 10 5-5 5 5M10 5v10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <rect x="6" y="6" width="8" height="8" rx="1.2" fill="currentColor" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="m11.5 5-5 5 5 5M7 10h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="m7 8 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="m5.5 10.3 2.8 2.8 6.2-6.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="10" cy="10" r="3.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M15.7 12.8A6.4 6.4 0 0 1 7.2 4.3 6.5 6.5 0 1 0 15.7 12.8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="7.5" cy="10" r="3.3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.8 10H17m-2 0v2m-2-2v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
