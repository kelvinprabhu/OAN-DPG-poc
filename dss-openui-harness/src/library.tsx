// Agri component library for OpenUI Lang. Prop key order = positional argument order.
import {
  action,
  createLibrary,
  defineComponent,
  FormNameContext,
  FormValidationContext,
  parseStructuredRules,
  useCreateFormValidation,
  useFormName,
  useFormValidation,
  useIsStreaming,
  useStateField,
  useTriggerAction,
} from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import "@openuidev/react-ui/components.css";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod/v4";

// ---------- leaf components ----------

const TextContent = defineComponent({
  name: "TextContent",
  description: "A block of text. variant: large-heavy (heading), body, muted.",
  props: z.object({
    text: z.string(),
    variant: z.enum(["large-heavy", "body", "muted"]).optional(),
  }),
  component: ({ props }) => <p className={`ou-text ou-text--${props.variant ?? "body"}`}>{props.text}</p>,
});

const Callout = defineComponent({
  name: "Callout",
  description: "Highlighted message. tone: info, warn, success, danger.",
  props: z.object({
    text: z.string(),
    tone: z.enum(["info", "warn", "success", "danger"]),
  }),
  component: ({ props }) => (
    <div className={`ou-callout ou-callout--${props.tone}`} role={props.tone === "danger" ? "alert" : "note"}>
      {props.text}
    </div>
  ),
});

const rulesSchema = z
  .object({
    required: z.boolean().optional(),
    minLength: z.number().optional(),
  })
  .optional();

function useFieldRules(name: string, rules: z.infer<typeof rulesSchema>, value: unknown) {
  const isStreaming = useIsStreaming();
  const validation = useFormValidation();
  const parsed = useMemo(() => parseStructuredRules(rules), [rules]);
  useEffect(() => {
    if (isStreaming || !validation || parsed.length === 0) return undefined;
    validation.registerField(name, parsed, () => value);
    return () => validation.unregisterField(name);
  }, [isStreaming, validation, parsed, name, value]);
  return { validation, parsed, error: validation?.errors[name] };
}

const Input = defineComponent({
  name: "Input",
  description: "Text-like form field. type: text, number, date, tel, email. rules: {required?, minLength?}.",
  props: z.object({
    name: z.string(),
    placeholder: z.string(),
    type: z.enum(["text", "number", "date", "tel", "email"]),
    rules: rulesSchema,
  }),
  component: ({ props }) => {
    const isStreaming = useIsStreaming();
    const field = useStateField(props.name);
    const value = (field.value as string | undefined) ?? "";
    const { validation, parsed, error } = useFieldRules(props.name, props.rules, value);
    return (
      <>
        <input
          className="ou-input"
          id={`f-${props.name}`}
          name={props.name}
          type={props.type}
          inputMode={props.type === "tel" ? "tel" : props.type === "number" ? "decimal" : undefined}
          placeholder={props.placeholder}
          value={value}
          required={props.rules?.required}
          disabled={isStreaming}
          aria-invalid={error ? true : undefined}
          onFocus={() => validation?.clearFieldError(props.name)}
          onChange={(e) => field.setValue(e.target.value)}
          onBlur={(e) => parsed.length > 0 && validation?.validateField(props.name, e.target.value, parsed)}
        />
        {error ? <span className="ou-field-error">{error}</span> : null}
      </>
    );
  },
});

const Select = defineComponent({
  name: "Select",
  description: "Dropdown form field with string options.",
  props: z.object({
    name: z.string(),
    options: z.array(z.string()),
    placeholder: z.string().optional(),
  }),
  component: ({ props }) => {
    const isStreaming = useIsStreaming();
    const field = useStateField(props.name);
    return (
      <select
        className="ou-input"
        id={`f-${props.name}`}
        name={props.name}
        value={(field.value as string | undefined) ?? ""}
        disabled={isStreaming}
        onChange={(e) => field.setValue(e.target.value)}
      >
        <option value="" disabled>
          {props.placeholder ?? "Select"}
        </option>
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  },
});

const FormControl = defineComponent({
  name: "FormControl",
  description: "Labelled form field: one of our Input or Select, or a built-in OpenUI field (RadioGroup, CheckBoxGroup, SwitchGroup, Chips, OptionCards, TextArea).",
  props: z.object({
    label: z.string(),
    field: z.union([Input.ref, Select.ref]),
  }),
  component: ({ props, renderNode }) => {
    const child = props.field as unknown as { typeName?: string; props?: { name?: string; value?: unknown } } | null;
    const typeName = child?.typeName;
    // A question bound to a $variable clears its answer when it disappears (a parent answer changed), so
    // hidden branches never leave stale answers behind.
    const bound = useStateField(child?.props?.name ?? "", child?.props?.value);
    const clear = useRef<() => void>(() => undefined);
    clear.current = () => {
      if (bound.isReactive) bound.setValue(typeName === "CheckBoxGroup" || typeName === "SwitchGroup" ? {} : "");
    };
    useEffect(() => () => clear.current(), []);
    // A <label> around a radio group would make a click anywhere pick its first option.
    const native = typeName === "Input" || typeName === "Select";
    return native ? (
      <label className="ou-control">
        <span className="ou-label">{props.label}</span>
        {renderNode(props.field)}
      </label>
    ) : (
      <div className="ou-control" role="group" aria-label={props.label}>
        <span className="ou-label">{props.label}</span>
        {renderNode(props.field)}
      </div>
    );
  },
});

const Button = defineComponent({
  name: "Button",
  description: "Action button. variant: primary, secondary.",
  props: z.object({
    label: z.string(),
    action: action(),
    variant: z.enum(["primary", "secondary"]).optional(),
  }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    const formName = useFormName();
    const isStreaming = useIsStreaming();
    const validation = useFormValidation();
    const variant = props.variant ?? "primary";
    return (
      <button
        type="button"
        className={`ou-button ou-button--${variant}`}
        disabled={isStreaming}
        onClick={() => {
          // Primary buttons inside a Form validate its fields first.
          if (validation && variant === "primary" && !validation.validateForm()) return;
          triggerAction(props.label, formName, props.action);
        }}
      >
        {props.label}
      </button>
    );
  },
});

const Buttons = defineComponent({
  name: "Buttons",
  description: "Group of buttons. layout: row, column.",
  props: z.object({
    buttons: z.array(Button.ref),
    layout: z.enum(["row", "column"]).optional(),
  }),
  component: ({ props, renderNode }) => (
    <div className={`ou-buttons ou-buttons--${props.layout ?? "row"}`}>{renderNode(props.buttons)}</div>
  ),
});

const Form = defineComponent({
  name: "Form",
  description: "Form with fields and action buttons. Field values are sent with the button action.",
  props: z.object({
    name: z.string(),
    actions: Buttons.ref,
    fields: z.array(FormControl.ref),
  }),
  component: ({ props, renderNode }) => {
    const validation = useCreateFormValidation();
    return (
      <FormValidationContext.Provider value={validation}>
        <FormNameContext.Provider value={props.name}>
          <div className="ou-form" role="form" aria-label={props.name}>
            {renderNode(props.fields)}
            {renderNode(props.actions)}
          </div>
        </FormNameContext.Provider>
      </FormValidationContext.Provider>
    );
  },
});

const ImageCard = defineComponent({
  name: "ImageCard",
  description: "Image with caption and optional badge.",
  props: z.object({
    src: z.string(),
    caption: z.string(),
    badge: z.string().optional(),
  }),
  component: ({ props }) => (
    <figure className="ou-imagecard">
      <img src={props.src} alt={props.caption} loading="lazy" />
      {props.badge ? <span className="ou-badge">{props.badge}</span> : null}
      <figcaption>{props.caption}</figcaption>
    </figure>
  ),
});

const ImageGrid = defineComponent({
  name: "ImageGrid",
  description: "Grid of ImageCards.",
  props: z.object({ images: z.array(ImageCard.ref) }),
  component: ({ props, renderNode }) => <div className="ou-imagegrid">{renderNode(props.images)}</div>,
});

const Table = defineComponent({
  name: "Table",
  description: "Table of string cells.",
  props: z.object({
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
  component: ({ props }) => (
    <div className="ou-table-wrap">
      <table className="ou-table">
        <thead>
          <tr>
            {props.headers.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
});

const BarChart = defineComponent({
  name: "BarChart",
  description: "Vertical bar chart (plain SVG).",
  props: z.object({
    title: z.string(),
    labels: z.array(z.string()),
    values: z.array(z.number()),
    unit: z.string(),
  }),
  component: ({ props }) => {
    const n = Math.min(props.labels.length, props.values.length);
    const max = Math.max(1, ...props.values.slice(0, n));
    const W = 320;
    const H = 180;
    const top = 22;
    const bottom = 24;
    const slot = W / Math.max(1, n);
    const barW = slot * 0.6;
    return (
      <figure className="ou-chart">
        <figcaption>
          {props.title} <span className="ou-muted">({props.unit})</span>
        </figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${props.title}, ${props.unit}`}>
          {Array.from({ length: n }, (_, i) => {
            const v = props.values[i];
            const h = ((H - top - bottom) * v) / max;
            const x = i * slot + (slot - barW) / 2;
            const y = H - bottom - h;
            return (
              <g key={i}>
                <rect x={x} y={y} width={barW} height={h} rx={3} className="ou-bar" />
                <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="ou-bar-value">
                  {v.toLocaleString("en-IN")}
                </text>
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="ou-bar-label">
                  {props.labels[i]}
                </text>
              </g>
            );
          })}
        </svg>
      </figure>
    );
  },
});

const StatCard = defineComponent({
  name: "StatCard",
  description: "Single headline value with label and optional hint.",
  props: z.object({
    label: z.string(),
    value: z.string(),
    hint: z.string().optional(),
  }),
  component: ({ props }) => (
    <div className="ou-stat">
      <div className="ou-stat-label">{props.label}</div>
      <div className="ou-stat-value">{props.value}</div>
      {props.hint ? <div className="ou-stat-hint">{props.hint}</div> : null}
    </div>
  ),
});

const Step = defineComponent({
  name: "Step",
  description: "One step with title and detail.",
  props: z.object({ title: z.string(), detail: z.string() }),
  component: ({ props }) => (
    <li className="ou-step">
      <strong>{props.title}</strong>
      <span>{props.detail}</span>
    </li>
  ),
});

const Steps = defineComponent({
  name: "Steps",
  description: "Numbered list of Steps.",
  props: z.object({ items: z.array(Step.ref) }),
  component: ({ props, renderNode }) => <ol className="ou-steps">{renderNode(props.items)}</ol>,
});

const TONE_COLOR = { info: "#1e6fb8", warn: "#d68a00", success: "#2e7d32", danger: "#c62828" } as const;

const MapMarker = defineComponent({
  name: "MapMarker",
  description: "A labelled point on a Map. lon and lat in GeoJSON order. value is short text such as '18 mm'. tone sets the colour.",
  props: z.object({
    label: z.string(),
    lon: z.number(),
    lat: z.number(),
    value: z.string().optional(),
    tone: z.enum(["info", "warn", "success", "danger"]).optional(),
  }),
  // Drawn by the parent Map, which reads these props.
  component: () => null,
});

const Map = defineComponent({
  name: "Map",
  description:
    "Street map (OpenStreetMap tiles). center is [longitude, latitude]; zoom 5 (state) to 12 (town). Each MapMarker is a coloured circle with a label.",
  props: z.object({
    center: z.array(z.number()),
    zoom: z.number(),
    markers: z.array(MapMarker.ref),
    caption: z.string().optional(),
  }),
  component: ({ props }) => {
    const el = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const layerRef = useRef<L.LayerGroup | null>(null);
    // Child elements expose their props on `.props` (same pattern as the built-in Select options).
    const markers = (props.markers ?? [])
      .map((m) => (m as unknown as { props?: z.infer<typeof MapMarker.props> }).props)
      .filter((m): m is z.infer<typeof MapMarker.props> => !!m && Number.isFinite(m.lon) && Number.isFinite(m.lat));
    const [lon, lat] = props.center.length >= 2 ? props.center : [0, 0];
    const key = JSON.stringify([lon, lat, props.zoom, markers]);

    useEffect(() => {
      if (!el.current) return undefined;
      const map = L.map(el.current, { scrollWheelZoom: false }).setView([lat, lon], props.zoom);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      return () => {
        map.remove();
        mapRef.current = null;
        layerRef.current = null;
      };
    }, []);

    useEffect(() => {
      const map = mapRef.current;
      const layer = layerRef.current;
      if (!map || !layer) return;
      map.setView([lat, lon], props.zoom);
      layer.clearLayers();
      for (const m of markers) {
        const color = TONE_COLOR[m.tone ?? "info"];
        L.circleMarker([m.lat, m.lon], { radius: 11, color, weight: 2, fillColor: color, fillOpacity: 0.55 })
          .bindTooltip(m.value ? `${m.label}: ${m.value}` : m.label, { permanent: true, direction: "auto", offset: [10, 0] })
          .addTo(layer);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return (
      <figure className="ou-map">
        <div ref={el} className="ou-map-canvas" role="img" aria-label={props.caption ?? "Map"} />
        {props.caption ? <figcaption>{props.caption}</figcaption> : null}
        <ul className="ou-map-list">
          {markers.map((m, i) => (
            <li key={i}>
              <span className="ou-dot" style={{ background: TONE_COLOR[m.tone ?? "info"] }} />
              {m.label}
              {m.value ? `: ${m.value}` : ""}
            </li>
          ))}
        </ul>
      </figure>
    );
  },
});

const Stack = defineComponent({
  name: "Stack",
  description: "Root layout. Stacks children vertically (column) or horizontally (row).",
  props: z.object({
    children: z.array(
      z.union([
        TextContent.ref,
        Callout.ref,
        Form.ref,
        Buttons.ref,
        ImageGrid.ref,
        Table.ref,
        BarChart.ref,
        StatCard.ref,
        Steps.ref,
        Map.ref,
        FormControl.ref,
      ]),
    ),
    direction: z.enum(["column", "row"]).optional(),
  }),
  component: ({ props, renderNode }) => (
    <div className={`ou-stack ou-stack--${props.direction ?? "column"}`}>{renderNode(props.children)}</div>
  ),
});

const baseLibrary = createLibrary({
  root: "Stack",
  components: [
    Stack,
    TextContent,
    Callout,
    Form,
    FormControl,
    Input,
    Select,
    Buttons,
    Button,
    ImageGrid,
    ImageCard,
    Table,
    BarChart,
    StatCard,
    Steps,
    Step,
    Map,
    MapMarker,
  ],
});

// Built-in OpenUI elements reused as they are (from @openuidev/react-ui). Slider and Tabs are left out:
// both froze the renderer in our jsdom tests.
const builtIn = openuiLibrary.components as Record<string, any>;
const field = (name: string) => ({ component: builtIn[name], slots: ["FormControl.field"] });

export const agriLibrary = baseLibrary.extend!({
  components: {
    add: [
      field("RadioGroup"),
      builtIn.RadioItem,
      field("CheckBoxGroup"),
      builtIn.CheckBoxItem,
      field("SwitchGroup"),
      builtIn.SwitchItem,
      field("Chips"),
      builtIn.ChipItem,
      field("OptionCards"),
      builtIn.OptionCard,
      field("TextArea"),
      { component: builtIn.Tag, slots: ["Stack.children"] },
    ],
  },
});
