import { AxiosError, AxiosInstance, AxiosResponse } from "axios";

import type { AxiosAuthRefreshRequestConfig } from "./types";
import { sleep } from "./utils";

let isRefreshing = false;

type QueueItem = { resolve: () => void; reject: (err: unknown) => void };
let queue: Array<QueueItem> = [];

type AddToQueue = { resolveAction: () => Promise<void> };

function addToQueue({ resolveAction }: AddToQueue) {
  return new Promise((resolve, reject) => {
    queue.push({
      resolve: () => resolve(resolveAction()),
      reject: (err: unknown) => reject(err),
    });
  });
}

type RefreshAndExecuteQueueProps<TData = unknown, TError = unknown> = {
  refreshAuthCall: () => Promise<AxiosResponse<TData>>;
  onSuccess?: (res?: AxiosResponse<TData>) => void;
  onError?: (err?: AxiosError<TError>) => void;
  options: AxiosAuthRefreshOptions;
};

const refreshAndExecuteQueue = async <TData = unknown, TError = unknown>({
  refreshAuthCall,
  onSuccess,
  onError,
  options,
}: RefreshAndExecuteQueueProps<TData, TError>) => {
  const { retryDelay, retries } = options;

  isRefreshing = true;

  let isRefreshed = false;
  let retriesLeft = retries;

  let refreshResponse: undefined | AxiosResponse<TData>;
  let refreshError: undefined | AxiosError<TError>;

  await (async () => {
    while (retriesLeft > 0 && !isRefreshed) {
      try {
        const response = await refreshAuthCall();
        refreshResponse = response;
        isRefreshed = true;
        retriesLeft--;
      } catch (error) {
        refreshError = <AxiosError<TError>>error;
        if (retriesLeft > 0) await sleep(retryDelay);
        else break;
        retriesLeft--;
      }
    }
  })();

  if (!isRefreshed) {
    queue.forEach((v) => v.reject("token wasnt refresh"));
    queue = [];
    onError?.(refreshError);
  } else {
    // TODO: resolve(token) ?
    await Promise.all(queue.map((v) => v.resolve()));
    queue = [];
    onSuccess?.(refreshResponse);
  }

  isRefreshing = false;
};

type AxiosAuthRefreshOptions = {
  retries: number;
  retryDelay: number;
  statusCodes: Array<number>;
};

type AxiosAuthRefreshProps<TData = unknown, TError = unknown> = {
  // TODO: axiosInstance`s ?
  axiosInstance: AxiosInstance;
  refreshAuthCall: () => Promise<AxiosResponse<TData>>;
  onSuccess?: (res?: AxiosResponse<TData>) => void;
  onError?: (err?: AxiosError<TError>) => void;
  options?: Partial<AxiosAuthRefreshOptions>;
};

export const axiosAuthRefresh = <TData = unknown, TError = unknown>({
  axiosInstance,
  refreshAuthCall, // <= TODO: skipAuthRefresh
  onError,
  onSuccess,
  options: optionsProp = {},
}: AxiosAuthRefreshProps<TData, TError>) => {
  const options = {
    statusCodes: [401],
    retryDelay: 300,
    retries: 3,
    ...optionsProp,
  };

  axiosInstance.interceptors.response.use(
    (response) => response,
    async (error: {
      config: AxiosAuthRefreshRequestConfig;
      response: AxiosResponse<TData>;
    }) => {
      const originalRequestConfig = error.config;
      const skipAuthRefresh = originalRequestConfig.skipAuthRefresh;
      const hasStatus = options.statusCodes.includes(error.response.status);

      if (!hasStatus || skipAuthRefresh) return Promise.reject(error);

      const resultPromise = addToQueue({
        // TODO: handleRepeatRequest: (originalRequest) => axiosInstance.request(originalRequest),
        resolveAction: () => axiosInstance.request(originalRequestConfig),
      });

      if (!isRefreshing) {
        refreshAndExecuteQueue<TData, TError>({
          refreshAuthCall,
          onSuccess,
          onError,
          options,
        });
      }

      return resultPromise;
    }
  );
};
