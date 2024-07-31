import { AxiosError, AxiosInstance, AxiosResponse } from 'axios';

import type { AxiosAuthRefreshRequestConfig } from './types';
import { sleep } from './utils';

let isRefreshing = false;
let callCount = 0;

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
  const { retryDelayMs, maxRetryCount, maxCallCount } = options;

  isRefreshing = true;

  let isRefreshed = false;
  let retryAttempts = 0;

  let refreshResponse: undefined | AxiosResponse<TData>;
  let refreshError: undefined | AxiosError<TError>;

  await (async () => {
    while (
      retryAttempts < maxRetryCount &&
      !isRefreshed &&
      callCount < maxCallCount
    ) {
      try {
        ++callCount;
        ++retryAttempts;
        // console.log(`Попытка обновления токена №${retryAttempts}`);
        const response = await refreshAuthCall();
        refreshResponse = response;
        isRefreshed = true;
      } catch (error) {
        refreshError = <AxiosError<TError>>error;
        console.error(`Ошибка обновления токена: ${refreshError.message}`);
        if (retryAttempts < maxRetryCount) await sleep(retryDelayMs);
        else break;
      }
    }
  })();

  if (!isRefreshed) {
    console.error(
      'Не удалось обновить токен после максимального количества попыток',
    );
    queue.forEach((v) => v.reject('Не удалось обновить токен'));
    queue = [];
    onError?.(refreshError);
  } else {
    // TODO: resolve(token) ?
    // console.log("Токен успешно обновлён");
    await Promise.all(queue.map((v) => v.resolve()));
    queue = [];
    onSuccess?.(refreshResponse);
  }

  isRefreshing = false;
};

type AxiosAuthRefreshOptions = {
  /** Количество попыток выполнения запроса */
  maxRetryCount: number;
  /** Задержка применяемая перед следующей попыткой выполнения запроса в мс */
  retryDelayMs: number;
  /** Коды состояния для которых отработает перехватчик */
  statusCodes: Array<number>;
  /** Максимальное количество попыток обновления токена */
  maxCallCount: number;
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
    retryDelayMs: 300,
    maxRetryCount: 3,
    maxCallCount: 3,
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
      const hasStatus = options.statusCodes.includes(error.response?.status);

      if (!hasStatus || skipAuthRefresh) return Promise.reject(error);

      if (callCount >= options.maxCallCount) {
        onError?.();
        const errorMessage =
          'Превышено максимальное количество попыток обновления токена';
        console.error(errorMessage);
        return Promise.reject(new Error(errorMessage));
      }

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
    },
  );
};
