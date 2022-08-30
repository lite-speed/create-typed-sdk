export type TypedSDKOptions = {
  doFetch: DoFetch;
  onSuccess?: (a: { newVal: unknown } & DoFetchArg) => void;
  onError?: (a: { error: unknown } & DoFetchArg) => void;
  onSettled?: (a: DoFetchArg) => void;
};

export function createTypedSDK<SDK extends DeepAsyncFnRecord<any>>(opts: TypedSDKOptions): TypedSDK<SDK> {
  const baseDoFetch: DoFetch = opts.doFetch;

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

export function collectApiFunctions<T extends DeepAsyncFnRecord<T>>(api: T): { path: string[]; fn: AsyncFn }[] {
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

  return collectLeafFunctions(api) as any;
}

type DoFetchArg = {
  path: string[];
  arg: any;
};
export type DoFetch = (p: DoFetchArg, ...otherArgs: any[]) => Promise<any>;

export type AsyncFn = (...args: any[]) => Promise<any>;

export type DeepAsyncFnRecord<T extends {}> = {
  [key in keyof T]: T[key] extends AsyncFn
    ? T[key]
    : T[key] extends (...args: any[]) => any //Blow up if non async function is at a object leaf...
    ? never
    : DeepAsyncFnRecord<T[key]>;
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
