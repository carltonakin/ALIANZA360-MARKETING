import Image from "next/image";

type BrandLogoProps = {
  variant?: "primary" | "mark";
  className?: string;
};

export function BrandLogo({ variant = "primary", className = "" }: BrandLogoProps) {
  const compact = variant === "mark";

  return (
    <Image
      className={className}
      src={compact ? "/next2thetop-crm-mark.svg" : "/next2thetop-crm-logo.svg"}
      width={compact ? 52 : 248}
      height={52}
      alt="Next2TheTop CRM"
    />
  );
}
