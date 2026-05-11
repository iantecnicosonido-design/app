import { useRef, useEffect } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "./ui/button";

/**
 * Drawing pad for client signature.
 * Props:
 *   - onChange(dataUrl|null) called when user draws/clears
 *   - height (default 180)
 *   - testId (data-testid prefix)
 */
export function SignaturePad({ onChange, height = 180, testId = "sig" }) {
  const ref = useRef(null);

  const emit = () => {
    if (!ref.current) return;
    if (ref.current.isEmpty()) {
      onChange && onChange(null);
    } else {
      // Note: avoid getTrimmedCanvas() — incompatible with current webpack/CRA setup
      // (trim-canvas default-export issue). Use the full canvas instead.
      onChange && onChange(ref.current.getCanvas().toDataURL("image/png"));
    }
  };

  const clear = () => {
    if (ref.current) {
      ref.current.clear();
      onChange && onChange(null);
    }
  };

  useEffect(() => {
    return () => { if (ref.current) ref.current.off(); };
  }, []);

  return (
    <div data-testid={`${testId}-wrap`}>
      <div style={{ border: "1.5px dashed var(--line)", background: "#fff", borderRadius: 8, overflow: "hidden", touchAction: "none" }}>
        <SignatureCanvas
          ref={ref}
          penColor="#1c1917"
          backgroundColor="rgba(255,255,255,0)"
          canvasProps={{
            width: 520, height,
            "data-testid": testId,
            style: { width: "100%", height, display: "block", cursor: "crosshair" },
          }}
          onEnd={emit}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <span style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>Firma del cliente</span>
        <Button type="button" variant="ghost" size="sm" onClick={clear} data-testid={`${testId}-clear`}>Limpiar</Button>
      </div>
    </div>
  );
}

/**
 * Convert a base64 PNG dataUrl to a Blob suitable for upload.
 */
export function dataUrlToBlob(dataUrl) {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8 = new Uint8Array(n);
  while (n--) u8[n] = bstr.charCodeAt(n);
  return new Blob([u8], { type: mime });
}
