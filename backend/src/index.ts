import { createDevTenant, resetDevData, rotateDevTenantApiKey } from "./api/dev";
import { createExtractionJob } from "./api/extract";
import { getJob } from "./api/jobs";
import { createTemplate, deleteTemplate, getTemplate, listTemplates, updateTemplate } from "./api/templates";
import { processJob } from "./consumer/processJob";
import { authenticate } from "./lib/auth";
import { HttpError, json, toHttpError } from "./lib/http";
import type { Env, QueueJobMessage } from "./lib/types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const httpError = toHttpError(error);
      return json(
        {
          error: {
            code: httpError.code,
            message: httpError.message
          }
        },
        httpError.status
      );
    }
  },

  async queue(batch: MessageBatch<QueueJobMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await processJob(msg.body, env);
        msg.ack();
      } catch (error) {
        console.error("Queue processing failed", error);
        msg.retry();
      }
    }
  }
} satisfies ExportedHandler<Env, QueueJobMessage>;

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/v1/health") {
    return json({ ok: true, service: "imageextraction-api" });
  }

  if (request.method === "POST" && url.pathname === "/v1/tenants") {
    return createDevTenant(request, env.DB);
  }

  if (request.method === "POST" && url.pathname === "/v1/dev/tenants") {
    return createDevTenant(request, env.DB);
  }

  if (request.method === "POST" && url.pathname === "/v1/dev/reset") {
    return resetDevData(env);
  }

  if (request.method === "POST" && url.pathname.startsWith("/v1/dev/tenants/") && url.pathname.endsWith("/api-key")) {
    const tenantId = decodeURIComponent(url.pathname.split("/")[4] || "");
    if (!tenantId) {
      throw new HttpError(404, "not_found", "Tenant not found");
    }
    return rotateDevTenantApiKey(request, env.DB, tenantId);
  }

  const tenant = await authenticate(request, env.DB);

  if (request.method === "POST" && url.pathname === "/v1/templates") {
    return createTemplate(request, env.DB, tenant);
  }
  if (request.method === "GET" && url.pathname === "/v1/templates") {
    return listTemplates(env.DB, tenant);
  }

  if (url.pathname.startsWith("/v1/templates/")) {
    const templateId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!templateId) {
      throw new HttpError(404, "not_found", "Template not found");
    }

    if (request.method === "GET") {
      return getTemplate(env.DB, tenant, templateId);
    }
    if (request.method === "PATCH") {
      return updateTemplate(request, env.DB, tenant, templateId);
    }
    if (request.method === "DELETE") {
      return deleteTemplate(env.DB, tenant, templateId);
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/extract") {
    return createExtractionJob(request, env, tenant);
  }

  if (request.method === "GET" && url.pathname.startsWith("/v1/jobs/")) {
    const jobId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!jobId) {
      throw new HttpError(404, "not_found", "Job not found");
    }
    return getJob(env.DB, tenant, jobId);
  }

  throw new HttpError(404, "not_found", "Route not found");
}
