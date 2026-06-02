import { beforeEach, describe, expect, it, vi } from "vitest";

const createAuthMock = vi.hoisted(() => vi.fn());

vi.mock("./lib/betterAuth", () => ({
  createAuth: createAuthMock,
}));

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    protected ctx: unknown;
    protected env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
  WorkflowEntrypoint: class {},
}));

import worker from "./index";

type ProductStoreStub = {
  createTemplate: ReturnType<typeof vi.fn>;
  listTemplates: ReturnType<typeof vi.fn>;
  getTemplate: ReturnType<typeof vi.fn>;
  updateTemplate: ReturnType<typeof vi.fn>;
  deleteTemplate: ReturnType<typeof vi.fn>;
  summarizePlanLimitUsage: ReturnType<typeof vi.fn>;
};

describe("Template product routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAuthMock.mockReturnValue({
      api: {
        getSession: vi.fn(async () => ({
          user: {
            id: "user_1",
            email: "ada@example.com",
            name: "Ada",
          },
        })),
      },
    });
  });

  it("creates Templates through the Workspace product store after session Workspace authorization", async () => {
    const legacyTemplateInsert = vi.fn(async () => {
      throw new Error("legacy Template table should not receive authoritative writes");
    });
    const productStore = createProductStoreStub();
    productStore.createTemplate.mockResolvedValue({
      template_id: "tpl_created",
      version: 1,
      status: "active",
    });
    const productStoreBinding = createProductStoreBinding(productStore);
    const analytics = createAnalyticsBinding();
    const env = createEnv({
      DB: createWorkspaceControlDb({
        sessionWorkspace: createWorkspaceControlRow({ apiKeyHash: null }),
        legacyTemplateInsert,
      }),
      WORKSPACE_PRODUCT_STORE: productStoreBinding,
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates", {
        method: "POST",
        headers: {
          "x-workspace-id": "workspace_1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Invoices",
          description: "Invoice extraction",
          fields: [
            {
              name: "Invoice Number",
              description: "Unique invoice identifier.",
              data_type: "string",
            },
          ],
        }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      template_id: "tpl_created",
      version: 1,
      status: "active",
    });
    expect(productStoreBinding.getByName).toHaveBeenCalledWith("workspace_1");
    expect(productStore.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Invoices",
        description: "Invoice extraction",
        fields: [
          {
            id: "invoice_number",
            name: "Invoice Number",
            description: "Unique invoice identifier.",
            data_type: "string",
          },
        ],
      }),
    );
    expect(legacyTemplateInsert).not.toHaveBeenCalled();
    expect(analytics.writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        indexes: ["workspace_1"],
        blobs: expect.arrayContaining(["template_created", "workspace_1", "tpl_created", "active"]),
        doubles: expect.arrayContaining([1]),
      }),
    );
  });

  it("returns a Template limit error from authoritative Workspace product data during Template creation", async () => {
    const productStore = createProductStoreStub();
    productStore.createTemplate.mockResolvedValue({
      error: {
        status: 400,
        code: "template_limit_exceeded",
        message: "Workspace Template limit reached",
      },
    });
    const productStoreBinding = createProductStoreBinding(productStore);

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates", {
        method: "POST",
        headers: {
          "x-workspace-id": "workspace_1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Invoices",
          fields: [
            {
              name: "Invoice Number",
              description: "Unique invoice identifier.",
              data_type: "string",
            },
          ],
        }),
      }),
      createEnv({
        DB: createWorkspaceControlDb({
          sessionWorkspace: createWorkspaceControlRow({ apiKeyHash: null, maxTemplates: 1 }),
        }),
        WORKSPACE_PRODUCT_STORE: productStoreBinding,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "template_limit_exceeded",
        message: "Workspace Template limit reached",
      },
    });
    expect(productStore.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTemplates: 1,
      }),
    );
  });

  it("blocks new Template creation when existing Templates exceed the Active entitlement", async () => {
    createAuthMock.mockReturnValue({
      api: {
        getSession: vi.fn(async () => ({
          user: {
            id: "user_1",
            email: "ada@example.com",
            name: "Ada",
          },
        })),
      },
    });
    const productStore = createProductStoreStub();
    productStore.summarizePlanLimitUsage.mockResolvedValue({
      active_template_count: 3,
      templates: [],
    });
    productStore.createTemplate.mockResolvedValue({
      template_id: "tpl_created",
      version: 1,
      status: "active",
    });
    const productStoreBinding = createProductStoreBinding(productStore);

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates", {
        method: "POST",
        headers: {
          "x-workspace-id": "workspace_1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Purchase Orders",
          fields: [
            {
              name: "Purchase Order Number",
              description: "Unique purchase order identifier.",
              data_type: "string",
            },
          ],
        }),
      }),
      createEnv({
        DB: createWorkspaceControlDb({
          sessionWorkspace: createWorkspaceControlRow({ apiKeyHash: null }),
        }),
        WORKSPACE_PRODUCT_STORE: productStoreBinding,
      }),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "template_limit_exceeded",
        message: "Workspace has reached the Free plan limit of 3 Templates",
      },
    });
    expect(productStore.createTemplate).not.toHaveBeenCalled();
  });

  it("blocks new Template creation with too many table-shaped fields", async () => {
    createAuthMock.mockReturnValue({
      api: {
        getSession: vi.fn(async () => ({
          user: {
            id: "user_1",
            email: "ada@example.com",
            name: "Ada",
          },
        })),
      },
    });
    const productStore = createProductStoreStub();
    productStore.createTemplate.mockResolvedValue({
      template_id: "tpl_created",
      version: 1,
      status: "active",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates", {
        method: "POST",
        headers: {
          "x-workspace-id": "workspace_1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Line Item Tables",
          fields: [
            tableField("Line Items"),
            tableField("Tax Lines"),
          ],
        }),
      }),
      createEnv({
        DB: createWorkspaceControlDb({
          sessionWorkspace: createWorkspaceControlRow({ apiKeyHash: null }),
        }),
        WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      }),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "template_table_limit_exceeded",
        message: "Template has exceeded the Free plan limit of 1 table-shaped field",
      },
    });
    expect(productStore.createTemplate).not.toHaveBeenCalled();
  });

  it("lists Templates from the Workspace product store after session Workspace authorization", async () => {
    const legacyTemplateRead = vi.fn(async () => {
      throw new Error("legacy Template table should not be required for authoritative reads");
    });
    const productStore = createProductStoreStub();
    productStore.listTemplates.mockResolvedValue([
      {
        id: "tpl_product",
        name: "Receipts",
        description: null,
        status: "active",
        current_version: 1,
        created_at: "2026-05-07T10:00:00.000Z",
        updated_at: "2026-05-07T10:00:00.000Z",
      },
    ]);
    const productStoreBinding = createProductStoreBinding(productStore);

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates", {
        method: "GET",
        headers: { "x-workspace-id": "workspace_1" },
      }),
      createEnv({
        DB: createWorkspaceControlDb({
          sessionWorkspace: createWorkspaceControlRow({ apiKeyHash: null }),
          legacyTemplateRead,
        }),
        WORKSPACE_PRODUCT_STORE: productStoreBinding,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      templates: [
        {
          id: "tpl_product",
          name: "Receipts",
          description: null,
          status: "active",
          current_version: 1,
          created_at: "2026-05-07T10:00:00.000Z",
          updated_at: "2026-05-07T10:00:00.000Z",
        },
      ],
    });
    expect(productStoreBinding.getByName).toHaveBeenCalledWith("workspace_1");
    expect(productStore.listTemplates).toHaveBeenCalledOnce();
    expect(legacyTemplateRead).not.toHaveBeenCalled();
  });

  it("lists Templates through the Workspace product store after session Workspace authorization", async () => {
    createAuthMock.mockReturnValue({
      api: {
        getSession: vi.fn(async () => ({
          user: {
            id: "user_1",
            email: "ada@example.com",
            name: "Ada",
          },
        })),
      },
    });
    const productStore = createProductStoreStub();
    productStore.listTemplates.mockResolvedValue([]);
    const productStoreBinding = createProductStoreBinding(productStore);

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates", {
        method: "GET",
        headers: { "x-workspace-id": "workspace_1" },
      }),
      createEnv({
        DB: createWorkspaceControlDb({
          sessionWorkspace: createWorkspaceControlRow({ apiKeyHash: null }),
        }),
        WORKSPACE_PRODUCT_STORE: productStoreBinding,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ templates: [] });
    expect(productStoreBinding.getByName).toHaveBeenCalledWith("workspace_1");
    expect(productStore.listTemplates).toHaveBeenCalledOnce();
  });

  it("gets Template detail with ordered fields from the Workspace product store after session Workspace authorization", async () => {
    const legacyTemplateRead = vi.fn(async () => {
      throw new Error("legacy Template table should not be required for authoritative detail reads");
    });
    const productStore = createProductStoreStub();
    productStore.getTemplate.mockResolvedValue({
      id: "tpl_product",
      name: "Receipts",
      description: "Receipt extraction",
      status: "active",
      current_version: 2,
      created_at: "2026-05-07T10:00:00.000Z",
      updated_at: "2026-05-08T10:00:00.000Z",
      fields: [
        {
          id: "merchant",
          name: "Merchant",
          description: "Merchant name.",
          data_type: "string",
          position: 0,
        },
        {
          id: "total",
          name: "Total",
          description: "Receipt total.",
          data_type: "number",
          position: 1,
        },
      ],
    });
    const productStoreBinding = createProductStoreBinding(productStore);

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates/tpl_product", {
        method: "GET",
        headers: { "x-workspace-id": "workspace_1" },
      }),
      createEnv({
        DB: createWorkspaceControlDb({
          sessionWorkspace: createWorkspaceControlRow({ apiKeyHash: null }),
          legacyTemplateRead,
        }),
        WORKSPACE_PRODUCT_STORE: productStoreBinding,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "tpl_product",
      name: "Receipts",
      description: "Receipt extraction",
      status: "active",
      current_version: 2,
      created_at: "2026-05-07T10:00:00.000Z",
      updated_at: "2026-05-08T10:00:00.000Z",
      fields: [
        {
          id: "merchant",
          name: "Merchant",
          description: "Merchant name.",
          data_type: "string",
          position: 0,
        },
        {
          id: "total",
          name: "Total",
          description: "Receipt total.",
          data_type: "number",
          position: 1,
        },
      ],
    });
    expect(productStoreBinding.getByName).toHaveBeenCalledWith("workspace_1");
    expect(productStore.getTemplate).toHaveBeenCalledWith("tpl_product");
    expect(legacyTemplateRead).not.toHaveBeenCalled();
  });

  it("returns not_found when Template detail is missing from Workspace product data", async () => {
    const productStore = createProductStoreStub();
    productStore.getTemplate.mockResolvedValue(null);
    const productStoreBinding = createProductStoreBinding(productStore);

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates/tpl_missing", {
        method: "GET",
        headers: { "x-workspace-id": "workspace_1" },
      }),
      createEnv({
        DB: createWorkspaceControlDb({
          sessionWorkspace: createWorkspaceControlRow({ apiKeyHash: null }),
        }),
        WORKSPACE_PRODUCT_STORE: productStoreBinding,
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "Template not found",
      },
    });
    expect(productStore.getTemplate).toHaveBeenCalledWith("tpl_missing");
  });

  it("updates Template fields through the Workspace product store and returns the new Template version", async () => {
    const legacyTemplateInsert = vi.fn(async () => {
      throw new Error("legacy Template table should not receive authoritative update writes");
    });
    const productStore = createProductStoreStub();
    productStore.updateTemplate.mockResolvedValue({
      template_id: "tpl_product",
      version: 3,
      status: "active",
    });
    const productStoreBinding = createProductStoreBinding(productStore);
    const analytics = createAnalyticsBinding();
    const env = createEnv({
      DB: createWorkspaceControlDb({
        sessionWorkspace: createWorkspaceControlRow({ apiKeyHash: null }),
        legacyTemplateInsert,
      }),
      WORKSPACE_PRODUCT_STORE: productStoreBinding,
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates/tpl_product", {
        method: "PATCH",
        headers: {
          "x-workspace-id": "workspace_1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Receipts",
          description: "Updated receipt extraction",
          fields: [
            {
              name: "Merchant",
              description: "Merchant name.",
              data_type: "string",
            },
            {
              name: "Total",
              description: "Receipt total.",
              data_type: "number",
            },
          ],
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      template_id: "tpl_product",
      version: 3,
      status: "active",
    });
    expect(productStore.updateTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "tpl_product",
        name: "Receipts",
        description: "Updated receipt extraction",
        fields: [
          {
            id: "merchant",
            name: "Merchant",
            description: "Merchant name.",
            data_type: "string",
          },
          {
            id: "total",
            name: "Total",
            description: "Receipt total.",
            data_type: "number",
          },
        ],
      }),
    );
    expect(legacyTemplateInsert).not.toHaveBeenCalled();
    expect(analytics.writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        indexes: ["workspace_1"],
        blobs: expect.arrayContaining(["template_updated", "workspace_1", "tpl_product", "active"]),
        doubles: expect.arrayContaining([2, 3]),
      }),
    );
  });

  it("returns a Template field limit error from authoritative Workspace product data during Template update", async () => {
    const productStore = createProductStoreStub();
    productStore.updateTemplate.mockResolvedValue({
      error: {
        status: 400,
        code: "template_field_limit_exceeded",
        message: "Template fields exceed Workspace limit of 1",
      },
    });
    const productStoreBinding = createProductStoreBinding(productStore);

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates/tpl_product", {
        method: "PATCH",
        headers: {
          "x-workspace-id": "workspace_1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          fields: [
            {
              name: "Merchant",
              description: "Merchant name.",
              data_type: "string",
            },
            {
              name: "Total",
              description: "Receipt total.",
              data_type: "number",
            },
          ],
        }),
      }),
      createEnv({
        DB: createWorkspaceControlDb({
          sessionWorkspace: createWorkspaceControlRow({ apiKeyHash: null, maxFieldsPerTemplate: 1 }),
        }),
        WORKSPACE_PRODUCT_STORE: productStoreBinding,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "template_field_limit_exceeded",
        message: "Template fields exceed Workspace limit of 1",
      },
    });
    expect(productStore.updateTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        maxFieldsPerTemplate: 1,
      }),
    );
  });

  it("blocks Template saves that leave an over-limit Template unchanged", async () => {
    createAuthMock.mockReturnValue({
      api: {
        getSession: vi.fn(async () => ({
          user: {
            id: "user_1",
            email: "ada@example.com",
            name: "Ada",
          },
        })),
      },
    });
    const productStore = createProductStoreStub();
    productStore.summarizePlanLimitUsage.mockResolvedValue({
      active_template_count: 3,
      templates: [
        {
          template_id: "tpl_product",
          top_level_template_fields: 6,
          table_shaped_fields: 0,
          max_table_columns_per_field: 0,
        },
      ],
    });
    productStore.updateTemplate.mockResolvedValue({
      template_id: "tpl_product",
      version: 3,
      status: "active",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates/tpl_product", {
        method: "PATCH",
        headers: {
          "x-workspace-id": "workspace_1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          description: "Still too many fields.",
        }),
      }),
      createEnv({
        DB: createWorkspaceControlDb({
          sessionWorkspace: createWorkspaceControlRow({ apiKeyHash: null }),
        }),
        WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      }),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "template_field_limit_exceeded",
        message: "Template has exceeded the Free plan limit of 5 top-level fields",
      },
    });
    expect(productStore.updateTemplate).not.toHaveBeenCalled();
  });

  it("deletes Templates through the Workspace product store after session Workspace authorization", async () => {
    const legacyTemplateDelete = vi.fn(async () => {
      throw new Error("legacy Template table should not receive authoritative delete writes");
    });
    const productStore = createProductStoreStub();
    productStore.deleteTemplate.mockResolvedValue(true);
    const productStoreBinding = createProductStoreBinding(productStore);

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates/tpl_product", {
        method: "DELETE",
        headers: { "x-workspace-id": "workspace_1" },
      }),
      createEnv({
        DB: createWorkspaceControlDb({
          sessionWorkspace: createWorkspaceControlRow({ apiKeyHash: null }),
          legacyTemplateInsert: legacyTemplateDelete,
        }),
        WORKSPACE_PRODUCT_STORE: productStoreBinding,
      }),
    );

    expect(response.status).toBe(204);
    expect(productStore.deleteTemplate).toHaveBeenCalledWith("tpl_product");
    expect(legacyTemplateDelete).not.toHaveBeenCalled();
  });

  it("does not route to the Workspace product store before Workspace authorization succeeds", async () => {
    createAuthMock.mockReturnValue({
      api: {
        getSession: vi.fn(async () => null),
      },
    });
    const productStoreBinding = createProductStoreBinding(createProductStoreStub());

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates", {
        method: "GET",
        headers: { authorization: "Bearer invalid-api-key" },
      }),
      createEnv({
        DB: createWorkspaceControlDb({ apiKeyHash: "not-the-presented-key" }),
        WORKSPACE_PRODUCT_STORE: productStoreBinding,
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "Invalid API key",
      },
    });
    expect(productStoreBinding.getByName).not.toHaveBeenCalled();
  });
});

function createEnv(overrides: Partial<Env>): Env {
  return {
    BETTER_AUTH_SECRET: "test-secret",
    ...overrides,
  } as Env;
}

function createProductStoreStub(): ProductStoreStub {
  return {
    createTemplate: vi.fn(),
    listTemplates: vi.fn(),
    getTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    summarizePlanLimitUsage: vi.fn(async () => ({
      active_template_count: 0,
      templates: [],
    })),
  };
}

function createProductStoreBinding(productStore: ProductStoreStub) {
  return {
    getByName: vi.fn(() => productStore),
  } as unknown as Env["WORKSPACE_PRODUCT_STORE"];
}

function createAnalyticsBinding(): Env["WORKSPACE_PRODUCT_ANALYTICS"] {
  return {
    writeDataPoint: vi.fn(),
  } as unknown as Env["WORKSPACE_PRODUCT_ANALYTICS"];
}

function createWorkspaceControlDb(input: {
  apiKeyHash?: string;
  workspace?: ReturnType<typeof createWorkspaceControlRow>;
  sessionWorkspace?: ReturnType<typeof createWorkspaceControlRow> | null;
  legacyTemplateInsert?: ReturnType<typeof vi.fn>;
  legacyTemplateRead?: ReturnType<typeof vi.fn>;
}): D1Database {
  return {
    batch: vi.fn(input.legacyTemplateInsert),
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes("FROM workspaces WHERE api_key_hash = ?")) {
            return input.apiKeyHash && params[0] === input.apiKeyHash
              ? input.workspace ?? createWorkspaceControlRow({ apiKeyHash: input.apiKeyHash })
              : null;
          }

          if (sql.includes("JOIN workspace_memberships")) {
            return params[0] === "workspace_1" && params[1] === "user_1" ? input.sessionWorkspace : null;
          }

          return null;
        }),
        all: vi.fn(input.legacyTemplateRead ?? (async () => ({ results: [] }))),
      })),
    })),
  } as unknown as D1Database;
}

function createWorkspaceControlRow(input: {
  apiKeyHash: string | null;
  maxTemplates?: number | null;
  maxFieldsPerTemplate?: number | null;
}) {
  return {
    id: "workspace_1",
    api_key_hash: input.apiKeyHash,
    name: "Research",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by_user_id: "user_1",
    rate_limit_per_minute: null,
    max_templates: input.maxTemplates ?? null,
    max_fields_per_template: input.maxFieldsPerTemplate ?? null,
    max_source_file_bytes: null,
  };
}

function tableField(name: string, columns = 1) {
  return {
    name,
    description: `${name} table.`,
    data_type: "array<object>",
    object_schema: {
      mode: "table",
      data_type: "array<object>",
      columns: Array.from({ length: columns }, (_, index) => ({
        heading: `Column ${index + 1}`,
        data_type: "string",
        description: `Column ${index + 1} value.`,
      })),
    },
  };
}
