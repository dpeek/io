import type { ValidationIssueInput } from "./graph/schema.js";

type SvgValidationIssue = ValidationIssueInput;

type SanitizedSvgSuccess = {
  ok: true;
  svg: string;
  viewBox: string;
};

type SanitizedSvgFailure = {
  ok: false;
  issues: SvgValidationIssue[];
};

export type SvgSanitizationResult = SanitizedSvgSuccess | SanitizedSvgFailure;

type SvgChildNode = SvgElementNode | string;

type SvgElementNode = {
  attrs: Array<{ name: string; value: string }>;
  children: SvgChildNode[];
  name: string;
};

type SanitizedSvgTreeResult =
  | {
      ok: true;
      node: SvgElementNode;
      viewBox: string;
    }
  | SanitizedSvgFailure;

const allowedSvgTags = new Set([
  "svg",
  "path",
  "g",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "title",
  "desc",
  "defs",
  "clipPath",
  "mask",
  "linearGradient",
  "radialGradient",
  "stop",
]);

const allowedSvgAttributes = new Set([
  "aria-hidden",
  "clip-path",
  "clip-rule",
  "clipPathUnits",
  "color",
  "cx",
  "cy",
  "d",
  "dx",
  "dy",
  "fill",
  "fill-opacity",
  "fill-rule",
  "filter",
  "focusable",
  "fx",
  "fy",
  "gradientTransform",
  "gradientUnits",
  "height",
  "href",
  "id",
  "mask",
  "mask-type",
  "maskContentUnits",
  "maskUnits",
  "offset",
  "opacity",
  "pathLength",
  "points",
  "preserveAspectRatio",
  "r",
  "role",
  "rx",
  "ry",
  "spreadMethod",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "transform",
  "vector-effect",
  "viewBox",
  "width",
  "x",
  "x1",
  "x2",
  "xlink:href",
  "xmlns",
  "xmlns:xlink",
  "y",
  "y1",
  "y2",
]);

const strippedRootSvgAttributes = new Set(["height", "width"]);
const namespacedSvgAttributes = new Set(["xlink:href", "xmlns:xlink"]);
const localReferenceAttributes = new Set(["href", "xlink:href"]);
const localReferenceValuePattern = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/;
const localUrlReferencePattern = /^url\(#([A-Za-z_][A-Za-z0-9_.:-]*)\)$/;
const safeSvgIdPattern = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const svgDimensionPattern = /^[+-]?(?:\d+\.?\d*|\d*\.\d+)(?:px)?$/i;
const xmlDeclarationPattern = /^\s*<\?xml[\s\S]*?\?>\s*/i;
const commentPattern = /<!--[\s\S]*?-->/g;

function createSvgIssue(code: string, message: string): SvgValidationIssue {
  return { code, message };
}

function invalidSvg(...issues: SvgValidationIssue[]): SanitizedSvgFailure {
  return { ok: false, issues };
}

function findTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | undefined;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (!character) break;

    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === ">") return index;
  }

  return -1;
}

function parseSvgTag(input: string):
  | {
      attrs: Array<{ name: string; value: string }>;
      name: string;
      selfClosing: boolean;
    }
  | SvgValidationIssue {
  const content = input.trim();
  const selfClosing = content.endsWith("/");
  const body = selfClosing ? content.slice(0, -1).trimEnd() : content;
  if (!body) {
    return createSvgIssue("svg.parse", "SVG markup contains an empty tag.");
  }

  let index = 0;
  while (index < body.length && !/\s/.test(body[index] ?? "")) index += 1;
  const name = body.slice(0, index);
  if (!name) {
    return createSvgIssue("svg.parse", "SVG markup contains a tag without a name.");
  }

  const attrs: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();

  while (index < body.length) {
    while (index < body.length && /\s/.test(body[index] ?? "")) index += 1;
    if (index >= body.length) break;

    const attrStart = index;
    while (
      index < body.length &&
      !/\s/.test(body[index] ?? "") &&
      body[index] !== "=" &&
      body[index] !== "/"
    ) {
      index += 1;
    }

    const attrName = body.slice(attrStart, index);
    if (!attrName) {
      return createSvgIssue("svg.parse", `SVG tag "${name}" contains a malformed attribute.`);
    }
    if (seen.has(attrName)) {
      return createSvgIssue(
        "svg.attribute.duplicate",
        `SVG tag "${name}" contains duplicate "${attrName}" attributes.`,
      );
    }
    seen.add(attrName);

    while (index < body.length && /\s/.test(body[index] ?? "")) index += 1;
    if (body[index] !== "=") {
      return createSvgIssue(
        "svg.parse",
        `SVG attribute "${attrName}" on "${name}" must use a quoted value.`,
      );
    }
    index += 1;

    while (index < body.length && /\s/.test(body[index] ?? "")) index += 1;
    const quote = body[index];
    if (quote !== '"' && quote !== "'") {
      return createSvgIssue(
        "svg.parse",
        `SVG attribute "${attrName}" on "${name}" must use a quoted value.`,
      );
    }
    index += 1;

    const valueStart = index;
    while (index < body.length && body[index] !== quote) index += 1;
    if (index >= body.length) {
      return createSvgIssue(
        "svg.parse",
        `SVG attribute "${attrName}" on "${name}" is missing its closing quote.`,
      );
    }
    const value = body.slice(valueStart, index);
    index += 1;

    attrs.push({ name: attrName, value });
  }

  return { attrs, name, selfClosing };
}

function parseSvgDimension(value: string | undefined): number | undefined {
  if (!value || !svgDimensionPattern.test(value)) return undefined;
  const numeric = Number.parseFloat(value.replace(/px$/i, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function isValidViewBox(value: string | undefined): value is string {
  if (!value) return false;
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!part.length) return false;
    const numeric = Number(part);
    return Number.isFinite(numeric);
  });
}

function validateSvgAttribute(
  tagName: string,
  attrName: string,
  attrValue: string,
): SvgValidationIssue | undefined {
  if (attrName.startsWith("on")) {
    return createSvgIssue(
      "svg.attribute.event",
      `SVG attribute "${attrName}" on "${tagName}" is not allowed.`,
    );
  }

  if (attrName === "style") {
    return createSvgIssue(
      "svg.attribute.style",
      'SVG style attributes are not supported. Use presentation attributes such as "fill" or "stroke" instead.',
    );
  }

  if (!allowedSvgAttributes.has(attrName)) {
    return createSvgIssue(
      "svg.attribute.unsupported",
      `SVG attribute "${attrName}" on "${tagName}" is not supported.`,
    );
  }

  if (attrName.includes(":") && !namespacedSvgAttributes.has(attrName)) {
    return createSvgIssue(
      "svg.attribute.namespace",
      `SVG attribute "${attrName}" on "${tagName}" is not allowed.`,
    );
  }

  const normalizedValue = attrValue.trim().toLowerCase();
  if (
    normalizedValue.includes("javascript:") ||
    normalizedValue.includes("vbscript:") ||
    normalizedValue.includes("data:")
  ) {
    return createSvgIssue(
      "svg.attribute.external",
      `SVG attribute "${attrName}" on "${tagName}" cannot use scriptable or external URLs.`,
    );
  }

  if (attrValue.includes("<") || attrValue.includes(">")) {
    return createSvgIssue(
      "svg.attribute.invalid",
      `SVG attribute "${attrName}" on "${tagName}" contains invalid markup characters.`,
    );
  }

  if (
    localReferenceAttributes.has(attrName) &&
    !localReferenceValuePattern.test(attrValue.trim())
  ) {
    return createSvgIssue(
      "svg.attribute.external",
      `SVG attribute "${attrName}" on "${tagName}" must reference an in-document id like "#shape".`,
    );
  }

  if (attrName === "id" && !safeSvgIdPattern.test(attrValue.trim())) {
    return createSvgIssue(
      "svg.attribute.id",
      `SVG attribute "id" on "${tagName}" must use a simple SVG-safe identifier.`,
    );
  }

  if (attrValue.includes("url(") && !localUrlReferencePattern.test(attrValue.trim())) {
    return createSvgIssue(
      "svg.attribute.external",
      `SVG attribute "${attrName}" on "${tagName}" must only reference in-document ids via "url(#...)".`,
    );
  }

  return undefined;
}

function sanitizeSvgElement(node: SvgElementNode): SanitizedSvgTreeResult {
  if (!allowedSvgTags.has(node.name)) {
    return invalidSvg(
      createSvgIssue("svg.tag.unsupported", `SVG tag "${node.name}" is not supported.`),
    );
  }

  const sanitizedAttrs: Array<{ name: string; value: string }> = [];
  let width: number | undefined;
  let height: number | undefined;
  let viewBox = "";

  for (const attr of node.attrs) {
    const issue = validateSvgAttribute(node.name, attr.name, attr.value);
    if (issue) return invalidSvg(issue);

    if (attr.name === "width") width = parseSvgDimension(attr.value);
    if (attr.name === "height") height = parseSvgDimension(attr.value);
    if (attr.name === "viewBox") viewBox = attr.value.trim();
    if (node.name === "svg" && strippedRootSvgAttributes.has(attr.name)) continue;

    sanitizedAttrs.push(attr);
  }

  if (node.name === "svg") {
    if (!isValidViewBox(viewBox)) {
      const derivedWidth = width;
      const derivedHeight = height;
      if (derivedWidth !== undefined && derivedHeight !== undefined) {
        viewBox = `0 0 ${derivedWidth} ${derivedHeight}`;
      } else {
        return invalidSvg(
          createSvgIssue(
            "svg.viewBox.missing",
            'SVG markup must include a valid "viewBox" or a numeric "width" and "height" pair that can be converted into one.',
          ),
        );
      }
    }

    const viewBoxIndex = sanitizedAttrs.findIndex((attr) => attr.name === "viewBox");
    if (viewBoxIndex === -1) {
      sanitizedAttrs.unshift({ name: "viewBox", value: viewBox });
    } else {
      sanitizedAttrs[viewBoxIndex] = { name: "viewBox", value: viewBox };
    }
    if (!sanitizedAttrs.some((attr) => attr.name === "xmlns")) {
      sanitizedAttrs.unshift({ name: "xmlns", value: "http://www.w3.org/2000/svg" });
    }
  }

  const sanitizedChildren: SvgChildNode[] = [];
  for (const child of node.children) {
    if (typeof child === "string") {
      if (child.trim().length > 0 && node.name !== "title" && node.name !== "desc") {
        return invalidSvg(
          createSvgIssue(
            "svg.text.unsupported",
            `SVG tag "${node.name}" cannot contain free text content.`,
          ),
        );
      }
      if (child.length > 0) sanitizedChildren.push(child);
      continue;
    }

    const childResult = sanitizeSvgElement(child);
    if (!childResult.ok) return childResult;
    sanitizedChildren.push(childResult.node);
  }

  return {
    ok: true,
    node: {
      name: node.name,
      attrs: sanitizedAttrs,
      children: sanitizedChildren,
    },
    viewBox,
  };
}

function serializeSvgNode(node: SvgElementNode): string {
  const attrs = node.attrs.map((attr) => ` ${attr.name}="${attr.value}"`).join("");
  if (node.children.length === 0) return `<${node.name}${attrs} />`;
  return `<${node.name}${attrs}>${node.children.map(serializeSvgChild).join("")}</${node.name}>`;
}

function serializeSvgChild(node: SvgChildNode): string {
  return typeof node === "string" ? node : serializeSvgNode(node);
}

export function sanitizeSvgMarkup(markup: string): SvgSanitizationResult {
  const trimmed = markup.trim();
  if (!trimmed) {
    return invalidSvg(createSvgIssue("svg.empty", "SVG markup must not be blank."));
  }

  if (
    trimmed.includes("<!DOCTYPE") ||
    trimmed.includes("<!ENTITY") ||
    trimmed.includes("<![CDATA[")
  ) {
    return invalidSvg(
      createSvgIssue(
        "svg.parse",
        "SVG markup must not include DOCTYPE, ENTITY, or CDATA declarations.",
      ),
    );
  }

  const withoutXmlDeclaration = trimmed.replace(xmlDeclarationPattern, "");
  if (withoutXmlDeclaration.includes("<?")) {
    return invalidSvg(
      createSvgIssue("svg.parse", "SVG markup must not include XML processing instructions."),
    );
  }

  const source = withoutXmlDeclaration.replace(commentPattern, "").trim();
  const stack: SvgElementNode[] = [];
  let root: SvgElementNode | undefined;
  let index = 0;

  while (index < source.length) {
    const nextTagStart = source.indexOf("<", index);
    if (nextTagStart === -1) {
      const trailingText = source.slice(index);
      if (trailingText.trim().length > 0) {
        if (stack.at(-1)?.name === "title" || stack.at(-1)?.name === "desc") {
          stack.at(-1)?.children.push(trailingText);
        } else {
          return invalidSvg(
            createSvgIssue(
              "svg.parse",
              "SVG markup contains unexpected text outside supported tags.",
            ),
          );
        }
      }
      break;
    }

    const text = source.slice(index, nextTagStart);
    if (text.trim().length > 0) {
      if (stack.at(-1)?.name === "title" || stack.at(-1)?.name === "desc") {
        stack.at(-1)?.children.push(text);
      } else {
        return invalidSvg(
          createSvgIssue(
            "svg.parse",
            "SVG markup contains unexpected text outside supported tags.",
          ),
        );
      }
    } else if (text.length > 0 && stack.length > 0) {
      stack.at(-1)?.children.push(text);
    }

    const nextTagEnd = findTagEnd(source, nextTagStart + 1);
    if (nextTagEnd === -1) {
      return invalidSvg(createSvgIssue("svg.parse", "SVG markup contains an unterminated tag."));
    }

    const rawTag = source.slice(nextTagStart + 1, nextTagEnd).trim();
    if (!rawTag) {
      return invalidSvg(createSvgIssue("svg.parse", "SVG markup contains an empty tag."));
    }

    if (rawTag.startsWith("/")) {
      const closingName = rawTag.slice(1).trim();
      const openNode = stack.pop();
      if (!closingName || /\s/.test(closingName)) {
        return invalidSvg(
          createSvgIssue("svg.parse", "SVG markup contains a malformed closing tag."),
        );
      }
      if (!openNode || openNode.name !== closingName) {
        return invalidSvg(
          createSvgIssue(
            "svg.parse",
            `SVG closing tag "${closingName}" does not match the currently open element.`,
          ),
        );
      }
      index = nextTagEnd + 1;
      continue;
    }

    const parsedTag = parseSvgTag(rawTag);
    if ("code" in parsedTag) return invalidSvg(parsedTag);

    const node: SvgElementNode = {
      name: parsedTag.name,
      attrs: parsedTag.attrs,
      children: [],
    };

    if (stack.length === 0) {
      if (root) {
        return invalidSvg(
          createSvgIssue(
            "svg.root.multiple",
            "SVG markup must contain exactly one root <svg> element.",
          ),
        );
      }
      root = node;
    } else {
      stack.at(-1)?.children.push(node);
    }

    if (!parsedTag.selfClosing) stack.push(node);
    index = nextTagEnd + 1;
  }

  if (stack.length > 0) {
    return invalidSvg(createSvgIssue("svg.parse", "SVG markup contains unclosed tags."));
  }

  if (!root) {
    return invalidSvg(
      createSvgIssue("svg.root.missing", "SVG markup must contain one root <svg> element."),
    );
  }

  if (root.name !== "svg") {
    return invalidSvg(
      createSvgIssue("svg.root.invalid", 'SVG markup must use "<svg>" as its root element.'),
    );
  }

  const result = sanitizeSvgElement(root);
  if (!result.ok) return result;

  return {
    ok: true,
    svg: serializeSvgNode(result.node),
    viewBox: result.viewBox,
  };
}

export function normalizeSvgMarkup(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const result = sanitizeSvgMarkup(value);
  return result.ok ? result.svg : value;
}

export function validateSvgMarkup(input: { value: unknown }): SvgValidationIssue[] | undefined {
  if (typeof input.value !== "string") {
    return [createSvgIssue("svg.invalid", "SVG markup must be provided as a string.")];
  }

  const result = sanitizeSvgMarkup(input.value);
  return result.ok ? undefined : result.issues;
}
