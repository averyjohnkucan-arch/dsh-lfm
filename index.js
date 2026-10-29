import z from "@deepseek-ai/schemastery";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Runtime } from "./lib/runtime.js";
import { LfmAdapter } from "./lib/adapter.js";

export const inject = ["llm", "webServer"];
export const Config = z.object({
  dataDir: z
    .string()
    .description("LFM profiles and downloaded runtime.")
    .default(""),
});

export async function apply(ctx, config) {
  const token = randomBytes(32).toString("hex");
  let registration;
  const runtime = new Runtime(config, () => registration?.replace(["lfm"]));
  await runtime.init();
  // Installation is a cancellable background job; model settings remain accessible on failure.
  await runtime.action("installEngine");
  ctx.effect(() => {
    registration = ctx.llm.registerAdapter(
      ["lfm"],
      new LfmAdapter(ctx, runtime),
    );
    return () => {
      registration?.();
      registration = undefined;
    };
  });
  ctx.inject(["modelScheduler"], (scope) =>
    scope.effect(() => {
      const scheduler = scope.get("modelScheduler");
      runtime.scheduler = scheduler;
      const unregister = scheduler.registerProvider("lfm", () =>
        runtime.profiles.filter((p) => p.enabled).map((p) => runtime.driver(p)),
      );
      return async () => {
        unregister();
        for (const p of runtime.profiles)
          await scheduler.unload("lfm:" + p.id, { force: true });
        runtime.scheduler = null;
      };
    }),
  );
  ctx.on("webserver/index-inject", (table) =>
    table.push({
      kind: "global",
      name: "__DSH_LFM__",
      value: { path: "/plugins/dsh-lfm/action", token },
    }),
  );
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "exact",
      path: "/plugins/dsh-lfm/action",
      handler: async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json");
        const key = Buffer.from(
          String(req.headers.authorization || "").replace(/^Bearer /, ""),
        );
        const expected = Buffer.from(token);
        const fail = (status, error) => {
          res.writeHead(status);
          res.end(JSON.stringify({ error }));
        };
        if (key.length !== expected.length || !timingSafeEqual(key, expected))
          return fail(401, "Owner capability required.");
        if (
          req.method !== "POST" ||
          !String(req.headers["content-type"]).startsWith("application/json")
        )
          return fail(405, "POST JSON required.");
        if (
          req.headers.origin &&
          req.headers.origin !== ctx.webServer.getOrigin()
        )
          return fail(403, "Origin refused.");
        try {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 2097152) throw Error("Request exceeds 2 MiB.");
            chunks.push(Buffer.from(chunk));
          }
          const { action, payload } = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          );
          res.end(
            JSON.stringify({ result: await runtime.action(action, payload) }),
          );
        } catch (error) {
          fail(400, error.message);
        }
      },
    }),
  );
  ctx.effect(() => () => runtime.dispose());
}
