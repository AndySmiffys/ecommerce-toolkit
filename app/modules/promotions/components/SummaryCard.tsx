type SummaryCardProps = {
  label: string;
  value: number | string;
  description: string;
  icon?: string;
  accent?: "green" | "blue" | "purple" | "amber" | "teal" | "pink";
};

const accents = {
  green: { background: "#e7f7ec", colour: "#15803d" },
  blue: { background: "#eaf2ff", colour: "#2563eb" },
  purple: { background: "#f2eafe", colour: "#7c3aed" },
  amber: { background: "#fff5df", colour: "#c77800" },
  teal: { background: "#e5f6f7", colour: "#087f8c" },
  pink: { background: "#fdebf3", colour: "#c0266d" },
} as const;

export function SummaryCard({
  label,
  value,
  description,
  icon,
  accent = "blue",
}: SummaryCardProps) {
  const accentStyle = accents[accent];

  return (
    <div
      style={{
        position: "relative",
        flex: "1 1 240px",
        minWidth: "220px",
        minHeight: "118px",
        overflow: "hidden",
        padding: "22px",
        border: "1px solid #e3e3e3",
        borderRadius: "16px",
        background: "linear-gradient(145deg, #ffffff 0%, #fbfbfb 100%)",
        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "78px",
          height: "78px",
          borderRadius: "0 0 0 78px",
          backgroundColor: accentStyle.background,
          color: accentStyle.colour,
          fontSize: "27px",
          fontWeight: 700,
        }}
      >
        {icon && (
          <span style={{ transform: "translate(8px, -7px)" }}>
            {icon}
          </span>
        )}
      </div>

      <div style={{ position: "relative", paddingRight: icon ? "56px" : 0 }}>
        <s-stack direction="block" gap="small">
          <div
            style={{
              color: "#616161",
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              lineHeight: 1.3,
              textTransform: "uppercase",
            }}
          >
            {label}
          </div>

          <div
            style={{
              color: "#202223",
              fontSize: "30px",
              fontWeight: 750,
              letterSpacing: "-0.025em",
              lineHeight: 1.15,
            }}
          >
            {value}
          </div>

          <div
            style={{
              maxWidth: "34ch",
              color: "#616161",
              fontSize: "13px",
              lineHeight: 1.5,
            }}
          >
            {description}
          </div>
        </s-stack>
      </div>
    </div>
  );
}
