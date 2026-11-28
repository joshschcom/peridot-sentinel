# OKX Onchain OS credentials

_DECISIONS D25. Maintained by Claude._

The three read credentials, `OKX_API_KEY`, `OKX_API_SECRET` and `OKX_API_PASSPHRASE`, exist in exactly two places:

1. **Vercel**: sensitive, server-side environment variables of the deployed app. Only the Node route handlers under `apps/web/src/app/api/onchainos/` read them. No name may start with `NEXT_PUBLIC_`, and the hosted checks scan the client bundle for the names.
2. **The founder's machine (optional)**: one file outside the repository, for the local MCP quote tool and for local live verification.

They never go in chat, logs, evidence, source control, the browser bundle, an MCP response or an agent's environment. Astra and Fable never read the file and never run the launcher. Changing a Vercel variable takes effect only for **new** deployments, so redeploy after changing one.

## Local setup (founder, once)
From the repository root, in your own terminal:

```sh
mkdir -p ../.okx-credentials && chmod 700 ../.okx-credentials
( umask 077 && : > ../.okx-credentials/onchainos.env )
open -e ../.okx-credentials/onchainos.env        # or: nano ../.okx-credentials/onchainos.env
```

Type or paste these three lines into the editor and save. No value goes through the shell, so none ends up in shell history.

```
OKX_API_KEY=...
OKX_API_SECRET=...
OKX_API_PASSPHRASE=...
```

Then confirm the result. This prints only "ok":

```sh
sh services/onchainos/with-okx-env.sh node -e 'process.exit(["OKX_API_KEY","OKX_API_SECRET","OKX_API_PASSPHRASE"].every(k=>process.env[k])?0:1)' && echo ok
```

How the launcher behaves:
- **What it accepts.** It requires the file to be outside the repository, owned by you and mode `600`. The file may contain nothing but those three names.
- **No code runs.** It parses the file instead of sourcing it, so nothing written in the file is executed.
- **Scope.** It exports the three values to the single command it starts. Use `PERIDOT_OKX_ENV=<path>` for a different location.

## Using it
- **MCP quote tool (Sentinel Connect).**
  ```sh
  sh services/onchainos/with-okx-env.sh node services/mcp-v2/host.mjs
  ```
  `host.mjs` passes the three names only to the MCP server process, never to the model's process. Every quote response has a fixed schema of amounts, asset identities and a timestamp.
- **Local live verification.** Run Astra's verifier through the launcher. It prints sanitized observations only.
- **Rotating.** Edit the file in place and update the Vercel variables, then redeploy. If you think a value has been exposed anywhere, revoke the key in the OKX developer portal first.
