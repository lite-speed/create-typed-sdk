import { Simplify } from "type-fest";
import axios from "axios";

type BaseOpts = {
  onSuccess?: (a: { newVal: unknown } & DoFetchArg) => void;
  onError?: (a: { error: unknown } & DoFetchArg) => void;
  onSettled?: (a: DoFetchArg) => void;
};

export type TypedSDKOptions = ({ url: string } & BaseOpts) | ({ doFetch: DoFetch } & BaseOpts);

export function createTypedSDK<SDK extends DeepAsyncFnRecord<any>>(opts: TypedSDKOptions): TypedSDK<SDK> {
  const baseDoFetch: DoFetch =
    "doFetch" in opts
      ? opts.doFetch
      : (p) => {
          const url = `${opts.url}/${p.path.join("/")}`;
          return axios.post(url, { requestArgument: p.arg }).then((resp) => resp.data.returnedData);
        };

  const doFetch: DoFetch = (args) => {
    const prom = baseDoFetch(args);

    prom
      .then(
        (v) => {
          opts.onSuccess?.({ newVal: v, ...args });
        },
        (err) => {
          opts.onError?.({ error: err, ...args });
        },
      )
      .finally(() => {
        opts.onSettled?.(args);
      });

    return prom;
  };

  const getNextQuery = (path: string[]): any => {
    return new Proxy(
      () => {}, //use function as base, so that it can be called...
      {
        apply: (__, key, args) => {
          const fetchArg = { arg: args[0], path };

          return doFetch(fetchArg, ...args.slice(1));
        },
        get(__, prop) {
          return getNextQuery(path.concat(prop.toString()));
        },
      },
    );
  };

  return getNextQuery([]);
}

export function collectEndpoints<T extends DeepAsyncFnRecord<T>>(api: T) {
  function collectLeafFunctions(value: any, path = [] as string[]) {
    const fns = [];
    if (isPlainObject(value) || Array.isArray(value)) {
      Object.keys(value).forEach((key) => {
        fns.push(...collectLeafFunctions(value[key], path.concat(key)));
      });
    } else {
      if (typeof value === "function") {
        fns.push({
          path,
          fn: value,
        });
      }
    }
    return fns;
  }
  return collectLeafFunctions(api);
}

export function attachApiToAppWithDefault<T extends DeepAsyncFnRecord<T>>(
  api: T,
  app: {
    post: (
      path: string,
      handler: (
        req: { body: any },
        resp: { send: (v: any) => any; statusCode: number } | { json: (v: any) => any; statusCode: number },
      ) => void,
    ) => any;
  },
) {
  collectEndpoints(api).forEach(({ fn, path }) => {
    if (!app.post) {
      throw new Error("No post method found on app! Ensure you are using a nodejs library like express or fastify");
    }

    app.post("/" + path.join("/"), async (req, resp) => {
      const send = (val: any) => {
        if ("send" in resp) {
          resp.send({ returnedData: val });
        } else if ("json" in resp) {
          resp.json({ returnedData: val });
        } else {
          throw new Error("Error sending!");
        }
      };

      try {
        if (!req.body || !req.body.requestArgument) {
          throw new Error(
            "Unable to find post body! Ensure your server parses the request body and attaches it to the request",
          );
        }

        if (!("send" in resp) && !("json" in resp)) {
          throw new Error(
            "Unable to find method to send response! Ensure you are using a nodejs library like express or fastify",
          );
        }

        if (!("statusCode" in resp)) {
          throw new Error(
            "Unable to find statusCode on response! Ensure you are using a nodejs library like express or fastify",
          );
        }

        const val = await fn(req.body.requestArgument);

        send(val);
      } catch (e) {
        resp.statusCode = e instanceof Error && typeof e["statusCode"] === "number" ? e["statusCode"] ?? 500 : 500;
        send({
          error: true,
          errorMessage:
            process?.env["NODE_ENV"] === "development" && e instanceof Error ? e.message : "An error occurred!",
        });
      }
    });
  });
}

type DoFetchArg = {
  path: string[];
  arg: any;
  //Context can typically only be added to by using interceptors. Unless you use the secret __doFetch method on the SDK, in which case you can set context at calltime
  context?: Record<string, any>;
};
export type DoFetch = (p: DoFetchArg, ...otherArgs: any[]) => Promise<any>;

export type AsyncFn = (...args: any[]) => Promise<any>;

export type DeepAsyncFnRecord<T extends {}> = {
  [key in keyof T]: T[key] extends AsyncFn ? T[key] : DeepAsyncFnRecord<T[key]>;
};

export type TypedSDK<SDK extends DeepAsyncFnRecord<SDK>> = {
  [key in keyof SDK]: SDK[key] extends AsyncFn
    ? Parameters<SDK[key]>[0] extends undefined
      ? () => ReturnType<SDK[key]>
      : (argument: Parameters<SDK[key]>[0]) => ReturnType<SDK[key]>
    : SDK[key] extends DeepAsyncFnRecord<SDK[key]>
    ? TypedSDK<SDK[key]>
    : never;
};

function isPlainObject(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto === null && value !== Object.prototype) {
    return true;
  }
  if (proto && Object.getPrototypeOf(proto) === null) {
    return true;
  }
  return false;
}
