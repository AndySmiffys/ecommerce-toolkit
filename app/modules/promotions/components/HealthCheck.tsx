export type HealthCheckTone =
  | "success"
  | "warning"
  | "critical"
  | "info";

type HealthCheckProps = {
  tone: HealthCheckTone;
  title: string;
  description: string;
  isLast?: boolean;
};

export function HealthCheck({
  tone,
  title,
  description,
  isLast = false,
}: HealthCheckProps) {
  const symbol =
    tone === "success"
      ? "✓"
      : tone === "critical"
        ? "!"
        : tone === "warning"
          ? "!"
          : "i";

  const symbolBackground =
    tone === "success"
      ? "#e3f1df"
      : tone === "critical"
        ? "#fee9e8"
        : tone === "warning"
          ? "#fff1d6"
          : "#eaf4ff";

  const symbolColour =
    tone === "success"
      ? "#1a7f37"
      : tone === "critical"
        ? "#b42318"
        : tone === "warning"
          ? "#8a6116"
          : "#005bd3";

  const rowBackground =
    tone === "critical"
      ? "#fff8f7"
      : tone === "warning"
        ? "#fffaf0"
        : tone === "info"
          ? "#f7fbff"
          : "#fbfdfb";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        marginBottom: isLast ? 0 : "10px",
        padding: "14px",
        border: `1px solid ${symbolBackground}`,
        borderRadius: "12px",
        backgroundColor: rowBackground,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "0 0 30px",
          width: "30px",
          height: "30px",
          borderRadius: "10px",
          backgroundColor: symbolBackground,
          color: symbolColour,
          fontSize: "15px",
          fontWeight: 750,
          lineHeight: 1,
        }}
      >
        {symbol}
      </div>

      <div
        style={{
          minWidth: 0,
          flex: 1,
        }}
      >
        <div
          style={{
            marginBottom: "3px",
            color: "#202223",
            fontWeight: 650,
            lineHeight: 1.4,
          }}
        >
          {title}
        </div>

        <div
          style={{
            color: "#616161",
            fontSize: "13px",
            lineHeight: 1.5,
          }}
        >
          {description}
        </div>
      </div>
    </div>
  );
}
