export type InputPrimitive = string | number | boolean;

export interface InputChoice {
  value: InputPrimitive;
  label: string;
  description?: string;
}

export interface JsonSchemaField {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  enumNames?: string[];
  oneOf?: Array<{ const?: unknown; title?: string; description?: string }>;
  items?: JsonSchemaField;
  format?: string;
  _meta?: { codex?: { isSecret?: boolean } };
  [key: string]: unknown;
}

export interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaField>;
  required?: string[];
  default?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface InputFieldDescriptor {
  key: string;
  schema: JsonSchemaField;
  type: string;
  options: InputChoice[] | null;
  multiple: boolean;
  required: boolean;
  title: string;
  secret: boolean;
}

const primitive = (value: unknown): value is InputPrimitive =>
  ["string", "number", "boolean"].includes(typeof value) &&
  !(typeof value === "number" && !Number.isFinite(value));

function choices(schema: JsonSchemaField): InputChoice[] | null {
  if (primitive(schema.const)) {
    return [{ value: schema.const, label: schema.title ?? String(schema.const) }];
  }
  if (
    Array.isArray(schema.enum) &&
    schema.enum.length &&
    schema.enum.every(primitive)
  ) {
    return schema.enum.map((value, index) => ({
      value,
      label: schema.enumNames?.[index] ?? String(value),
    }));
  }
  if (
    Array.isArray(schema.oneOf) &&
    schema.oneOf.length &&
    schema.oneOf.every((item) => primitive(item.const))
  ) {
    return schema.oneOf.map((item) => {
      const value = item.const as InputPrimitive;
      return {
        value,
        label: item.title ?? String(value),
        description: item.description,
      };
    });
  }
  return null;
}

/** 将 JSON Schema 解析为受支持的交互式表单字段列表 */
export function inputFields(
  schema: JsonSchemaObject | null | undefined,
): InputFieldDescriptor[] | null {
  if (
    schema?.type !== "object" ||
    !schema.properties ||
    typeof schema.properties !== "object" ||
    Array.isArray(schema.properties) ||
    [
      "$ref",
      "allOf",
      "anyOf",
      "oneOf",
      "if",
      "dependentSchemas",
      "dependentRequired",
      "patternProperties",
    ].some((key) => key in schema)
  ) {
    return null;
  }

  const entries = Object.entries(schema.properties);
  if (entries.length > 32) {
    return null;
  }

  const fields: InputFieldDescriptor[] = [];
  for (const [key, value] of entries) {
    if (
      !value ||
      typeof value !== "object" ||
      ["$ref", "allOf", "anyOf", "if", "not"].some((k) => k in value)
    ) {
      return null;
    }
    const options = choices(value);
    const multiple = value.type === "array";
    const itemOptions = multiple ? choices(value.items ?? {}) : null;
    if (value.oneOf && !options) {
      return null;
    }
    if (
      !options &&
      !["string", "number", "integer", "boolean"].includes(value.type ?? "") &&
      !itemOptions
    ) {
      return null;
    }
    if (multiple && !itemOptions) {
      return null;
    }
    const fallbackType = options?.[0] ? typeof options[0].value : "string";
    fields.push({
      key,
      schema: value,
      type: value.type ?? fallbackType,
      options: options ?? itemOptions,
      multiple,
      required: schema.required?.includes(key) ?? false,
      title: value.title || key,
      secret:
        value._meta?.codex?.isSecret === true || value.format === "password",
    });
  }
  return fields;
}

/** 根据字段定义生成表单初始值 */
export function initialInputValues(
  fields: InputFieldDescriptor[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.schema.default ??
        (field.multiple
          ? []
          : field.options
            ? undefined
            : field.type === "boolean"
              ? field.required
                ? false
                : undefined
              : ""),
    ]),
  );
}

/** 提取并校验表单输入内容，构造提交载荷 */
export function inputContent(
  fields: InputFieldDescriptor[],
  values: Record<string, unknown>,
  validate = true,
): Record<string, unknown> {
  const entries: Array<[string, unknown]> = [];
  for (const field of fields) {
    let value = values[field.key];
    const numeric = ["number", "integer"].includes(field.type);
    const blankNumber =
      numeric && typeof value === "string" && !value.trim();
    const empty =
      value === undefined ||
      (value === "" && !field.options) ||
      blankNumber ||
      (Array.isArray(value) && !value.length);

    if (empty && !field.required) {
      continue;
    }
    if (validate && field.required && (value === undefined || blankNumber)) {
      throw new Error(`请填写${field.title}`);
    }
    if (numeric && !blankNumber) {
      if (validate && !["number", "string"].includes(typeof value)) {
        throw new Error(`${field.title}需要数字`);
      }
      const num = Number(value);
      if (
        validate &&
        (!Number.isFinite(num) ||
          (field.type === "integer" && !Number.isInteger(num)))
      ) {
        throw new Error(
          `${field.title}需要${field.type === "integer" ? "整数" : "数字"}`,
        );
      }
      if (Number.isFinite(num)) {
        value = num;
      }
    }
    if (validate && field.options) {
      const selected = field.multiple ? value : [value];
      if (
        !Array.isArray(selected) ||
        selected.some(
          (item) =>
            !field.options?.some((option) => Object.is(item, option.value)),
        )
      ) {
        throw new Error(`请选择${field.title}提供的选项`);
      }
    }
    if (validate && field.type === "string" && typeof value !== "string") {
      throw new Error(`${field.title}需要文本`);
    }
    if (validate && field.type === "boolean" && typeof value !== "boolean") {
      throw new Error(`${field.title}需要布尔值`);
    }
    entries.push([field.key, value]);
  }
  return Object.fromEntries(entries);
}

/** 将 JSON 对象回填为表单值，若超出表单表达能力则抛出提示 */
export function valuesFromInput(
  fields: InputFieldDescriptor[],
  content: unknown,
): Record<string, unknown> {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("补充输入必须是JSON对象");
  }
  const record = content as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !fields.some((field) => field.key === key),
    )
  ) {
    throw new Error("JSON包含表单未覆盖的字段，请继续使用JSON输入");
  }
  for (const field of fields) {
    const value = record[field.key];
    if (value === undefined) {
      continue;
    }
    if (
      field.multiple
        ? !Array.isArray(value) || value.some((item) => !primitive(item))
        : !primitive(value)
    ) {
      throw new Error(`${field.title}的内容请在JSON模式中编辑`);
    }
  }
  const values = { ...initialInputValues(fields), ...record };
  inputContent(fields, values);
  return values;
}

/** 根据 Schema 默认值生成初始 JSON 字符串 */
export function initialInputJson(
  schema: JsonSchemaObject | null | undefined,
): string {
  return JSON.stringify(
    schema?.default ??
      Object.fromEntries(
        Object.entries(schema?.properties ?? {})
          .filter(([, field]) => field?.default !== undefined)
          .map(([key, field]) => [key, field.default]),
      ),
    null,
    2,
  );
}
