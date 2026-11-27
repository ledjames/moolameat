export type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
};

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function xmlElement(
  name: string,
  content: string | null | undefined,
  attributes?: Record<string, string>,
): string {
  const attrs = attributes
    ? Object.entries(attributes)
        .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
        .join("")
    : "";
  if (content === null || content === undefined) {
    return `<${name}${attrs}/>`;
  }
  return `<${name}${attrs}>${content}</${name}>`;
}

const DECODE: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, token: string) => {
    if (token.startsWith("#x") || token.startsWith("#X")) {
      const code = Number.parseInt(token.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    if (token.startsWith("#")) {
      const code = Number.parseInt(token.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return DECODE[token] ?? entity;
  });
}

export function parseXml(source: string): XmlNode {
  const xml = source.replace(/<\?xml[\s\S]*?\?>/g, "").trim();
  let index = 0;

  function skipWhitespace() {
    while (index < xml.length && /\s/.test(xml[index] ?? "")) index += 1;
  }

  function parseNode(): XmlNode | null {
    skipWhitespace();
    if (xml.startsWith("<!--", index)) {
      const end = xml.indexOf("-->", index);
      if (end === -1) throw new Error("Unclosed XML comment");
      index = end + 3;
      return parseNode();
    }
    if (xml[index] !== "<" || xml.startsWith("</", index)) return null;

    index += 1;
    const name = readName();
    const attributes: Record<string, string> = {};
    while (index < xml.length) {
      skipWhitespace();
      if (xml[index] === ">" || xml[index] === "/") break;
      const attr = readName();
      skipWhitespace();
      if (xml[index] !== "=") {
        throw new Error(`XML attribute ${attr} is missing a value`);
      }
      index += 1;
      skipWhitespace();
      const quote = xml[index];
      if (quote !== '"' && quote !== "'") {
        throw new Error(`XML attribute ${attr} is not quoted`);
      }
      index += 1;
      const start = index;
      while (index < xml.length && xml[index] !== quote) index += 1;
      attributes[attr] = decodeXml(xml.slice(start, index));
      index += 1;
    }

    if (xml[index] === "/" && xml[index + 1] === ">") {
      index += 2;
      return { name, attributes, children: [], text: "" };
    }
    if (xml[index] !== ">") throw new Error(`XML element ${name} was not closed`);
    index += 1;

    const children: XmlNode[] = [];
    let text = "";
    while (index < xml.length && !xml.startsWith("</", index)) {
      if (xml[index] === "<") {
        const child = parseNode();
        if (child) children.push(child);
        continue;
      }
      const next = xml.indexOf("<", index);
      const raw = xml.slice(index, next === -1 ? xml.length : next);
      text += raw;
      index = next === -1 ? xml.length : next;
    }

    if (!xml.startsWith("</", index)) {
      throw new Error(`XML element ${name} has no closing tag`);
    }
    index += 2;
    const close = readName();
    if (close !== name) {
      throw new Error(`XML close tag ${close} does not match ${name}`);
    }
    skipWhitespace();
    if (xml[index] !== ">") throw new Error(`XML close tag ${name} was not closed`);
    index += 1;

    return {
      name,
      attributes,
      children,
      text: decodeXml(text).trim(),
    };
  }

  function readName(): string {
    const start = index;
    while (index < xml.length && /[A-Za-z0-9_:-]/.test(xml[index] ?? "")) index += 1;
    const name = xml.slice(start, index);
    if (!name) throw new Error("XML name is empty");
    return name;
  }

  const root = parseNode();
  if (!root) throw new Error("XML document has no root element");
  return root;
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((entry) => entry.name === name);
}

export function childrenNamed(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((entry) => entry.name === name) ?? [];
}

export function descendants(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  for (const entry of node.children) {
    if (entry.name === name) found.push(entry);
    found.push(...descendants(entry, name));
  }
  return found;
}

export function textOf(node: XmlNode | undefined, name: string): string | undefined {
  const found = child(node, name);
  const value = found?.text.trim();
  return value ? value : undefined;
}
