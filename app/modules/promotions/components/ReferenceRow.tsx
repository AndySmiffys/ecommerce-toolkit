type ReferenceRowProps = {
  title: string;
  typeLabel?: string;
  subtitle?: string;
  icon?: string;
  accent?: "purple" | "amber" | "teal" | "blue";
  isLast?: boolean;
};

const accents = {
  purple: { background: "#f2eafe", colour: "#7c3aed" },
  amber: { background: "#fff5df", colour: "#c77800" },
  teal: { background: "#e5f6f7", colour: "#087f8c" },
  blue: { background: "#eaf2ff", colour: "#2563eb" },
} as const;

export function ReferenceRow({
  title,
  typeLabel,
  subtitle,
  icon = "◇",
  accent = "purple",
  isLast = false,
}: ReferenceRowProps) {
  const accentStyle = accents[accent];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        padding: "13px 0",
        borderBottom: isLast ? "none" : "1px solid #e3e3e3",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          gap: "12px",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 36px",
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            background: accentStyle.background,
            color: accentStyle.colour,
            fontSize: "18px",
            fontWeight: 700,
          }}
        >
          {icon}
        </div>

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 650,
              lineHeight: 1.35,
              overflowWrap: "anywhere",
            }}
          >
            {title}
          </div>

          {subtitle && (
            <div
              style={{
                marginTop: "2px",
                color: "#616161",
                fontSize: "13px",
                lineHeight: 1.35,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      </div>

      {typeLabel && <s-badge>{typeLabel}</s-badge>}
    </div>
  );
}
