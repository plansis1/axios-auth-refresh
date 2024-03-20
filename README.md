# axios-auth-refresh

Этот простой модуль обеспечивает отправку единого запроса на обновление токена даже при обработке одновременных запросов. 
Кроме того, он предлагает методы для последовательной интеграции запросов Axios с различными библиотеками.

## Basic Usage

```typescript
import axios from 'axios';
import { axiosAuthRefresh } from '@plansis/axios-auth-refresh';

const axiosInstance = axios.create({
  withCredentials: true,
  baseURL: 'https://example.com/api',
});

const handleRefreshAuthCall = async () => {
  const response = await axiosInstance.post<TData>(
    '/refresh',
    {},
    { skipAuthRefresh: true },
  );
  return response;
};

const onRefreshSuccess = (res: AxiosResponse<TData>) => {
  console.log('success:', res);
};

const onRefreshError = (err: AxiosError<TError>) => {
  console.log('error:', err);
};

axiosAuthRefresh<TData, TError>({
  axiosInstance,
  refreshAuthCall: handleRefreshAuthCall,
  onSuccess: onRefreshSuccess,
  onError: onRefreshError,
  options: {
    retries: 5,
    retryDelay: 300,
    statusCodes: [401, 403],
  },
});
```
