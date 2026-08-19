import { AsyncLocalStorage } from "node:async_hooks";

import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";

// The LangGraph package initializes this automatically in its Node entrypoint,
// but Cloudflare-compatible RSC bundles select the web entrypoint. nodejs_compat
// provides AsyncLocalStorage, so initialize the shared singleton explicitly.
AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
