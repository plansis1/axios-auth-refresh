let isRefreshing = false;
let queue = [];
function addToQueue({ resolveAction }) {
    return new Promise((resolve, reject) => {
        queue.push({
            resolve: () => resolve(resolveAction()),
            reject: (err) => reject(err),
        });
    });
}
const refreshAndExecuteQueue = async ({ refreshAuthCall, onSuccess, onError, options, }) => {
    const { retryDelay, retries } = options;
    isRefreshing = true;
    let isRefreshed = false;
    let retriesLeft = retries;
    let refreshResponse;
    let refreshError;
    await (async () => {
        while (retriesLeft > 0 && !isRefreshed) {
            try {
                const response = await refreshAuthCall();
                refreshResponse = response;
                isRefreshed = true;
                retriesLeft--;
            }
            catch (error) {
                refreshError = error;
                if (retriesLeft > 0)
                    await sleep(retryDelay);
                else
                    break;
                retriesLeft--;
            }
        }
    })();
    if (!isRefreshed) {
        queue.forEach((v) => v.reject("token wasnt refresh"));
        queue = [];
        onError?.(refreshError);
    }
    else {
        // TODO: resolve(token) ?
        await Promise.all(queue.map((v) => v.resolve()));
        queue = [];
        onSuccess?.(refreshResponse);
    }
    isRefreshing = false;
};
export const axiosAuthRefresh = ({ axiosInstance, refreshAuthCall, onError, onSuccess, options: optionsProp = {}, }) => {
    const options = {
        statusCodes: [401],
        retryDelay: 300,
        retries: 3,
        ...optionsProp,
    };
    axiosInstance.interceptors.response.use((response) => response, async (error) => {
        const originalRequestConfig = error.config;
        const skipAuthRefresh = originalRequestConfig.skipAuthRefresh;
        const hasStatus = options.statusCodes.includes(error.response.status);
        if (!hasStatus || skipAuthRefresh)
            return Promise.reject(error);
        const resultPromise = addToQueue({
            // TODO: handleRepeatRequest: (originalRequest) => axiosInstance.request(originalRequest),
            resolveAction: () => axiosInstance.request(originalRequestConfig),
        });
        if (!isRefreshing) {
            refreshAndExecuteQueue({
                refreshAuthCall,
                onSuccess,
                onError,
                options,
            });
        }
        return resultPromise;
    });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
//# sourceMappingURL=axios-auth-refresh.js.map