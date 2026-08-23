/* Loading page.js for tests.
 *
 * The file expects a browser: it reads its data out of a <script> tag and wires
 * listeners to controls that only exist in the generated page. Rather than
 * reproduce a DOM, this gives it just enough of one to finish loading, and then
 * reaches into the module scope for the pure functions worth testing.
 *
 * Everything stubbed here is a stand-in for something the browser provides, not
 * for anything the code under test does.
 */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/* One school, one class, and a real week's worth of shape.
 *
 * page.js renders at load, so simply loading it exercises the whole render path
 * — but only if there is something to render. With an empty class the timeline,
 * the lesson boxes, the colour lookup and the packing never run at all, and a
 * fault in any of them goes unnoticed. Hence a lesson, its continuation row, a
 * division to filter by and a break to draw. */
const DATA = {
  edupage: "tera", year: 2026, initialSchool: "68", initialClass: "8",
  lang: "en", built: "", counts: false,
  languages: [["en", "English"], ["et", "Eesti"]],
  strings: { en: { classN: "class {0}" }, et: { classN: "{0}. klass" } },
  palette: { Matemaatika: { bg: "#83EC9B", fg: "#14171A" },
             Kunst: { bg: "#F6C1ED", fg: "#14171A" } },
  subjects: { Matemaatika: { short: "Mat" }, Kunst: { short: "Ku" } },
  schools: [{
    n: "68", l: "A school", t: "A school 2026", v: "", b: true, bn: "Plan",
    d: [{ i: 0, n: "Monday" }],
    p: [{ n: 1, l: "1", s: "", e: "" }, { n: 2, l: "2", s: "", e: "" },
        { n: 3, l: "3", s: "", e: "" }],
    ts: false,
    c: [{
      n: "8", m: 3,
      v: [{ id: "d1", groups: ["A", "B"], l: "Kunst", sj: ["Kunst"] }],
      h: { 0: { s: [{ p: 1, d: 2, a: "9.00", z: "10.20" },
                    { p: 3, d: 1, a: "10.30", z: "11.15" }],
                b: [{ a: 1, n: "Break, and more", s: "10.20", e: "10.30",
                      m: 620, x: 630 }] } },
      e: [
        { d: 0, p: 1, s: "Matemaatika", S: 0, g: [], t: ["MT"], T: ["Mari Tamm"],
          r: ["A101"], c: 0, k: 1, u: 2, w: "9.00–10.20", o: 0, a: 540, z: 620 },
        { d: 0, p: 2, s: "Matemaatika", S: 0, g: [], t: ["MT"], T: ["Mari Tamm"],
          r: ["A101"], c: 1, k: 1, u: 2, w: "9.00–10.20", o: 0, a: 540, z: 620 },
        { d: 0, p: 3, s: "Kunst", S: 0, g: ["A"], t: ["KK"], T: ["Kati Kask"],
          r: ["A102"], c: 0, k: 2, u: 1, w: "10.30–11.15", o: 0, a: 630, z: 675 },
      ],
    }],
  }],
};

function element() {
  const node = {
    value: "", textContent: "", innerHTML: "", checked: false, placeholder: "",
    hidden: false, open: false, disabled: false, title: "", dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    removeChild() {}, click() {}, focus() {}, blur() {}, select() {},
    setSelectionRange() {}, getBoundingClientRect: () => ({
      top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, remove() {},
  };
  return node;
}

export function load() {
  const data = element();
  data.textContent = JSON.stringify(DATA);
  const context = {
    console,
    JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Set, Map,
    TextEncoder, TextDecoder, btoa, atob, setTimeout, clearTimeout, parseFloat, parseInt, isNaN,
    document: {
      documentElement: element(),
      body: element(),
      getElementById: (id) => (id === "data" ? data : element()),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => element(),
      createRange: () => ({ selectNodeContents() {}, selectNode() {} }),
      addEventListener() {},
    },
    location: { href: "https://example.test/t/", hash: "", search: "" },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    getComputedStyle: () => ({ color: "rgb(0, 0, 0)", marginTop: "0", marginBottom: "0" }),
    /* Colour validity: the real one is the browser's CSS parser. This accepts
       hex and a few names, which is all the tests exercise. */
    CSS: { supports: (_prop, value) =>
      /^#[0-9a-fA-F]{3,8}$/.test(value) ||
      /^(orange|red|green|blue|white|black|rebeccapurple|mediumseagreen)$/.test(value) ||
      /^rgba?\(/.test(value) },
    qrcode: () => ({ addData() {}, make() {}, getModuleCount: () => 21, isDark: () => false }),
  };
  context.window = context;
  createContext(context);
  runInContext(readFileSync(join(root, "page.js"), "utf8"), context, { filename: "page.js" });
  /* Top-level const and function declarations stay in the context's lexical
     scope, so a second script in the same context can reach them. */
  return (expression) => runInContext(expression, context);
}
