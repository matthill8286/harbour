import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'leaflet/dist/leaflet.css';
import './theme/harbour-tokens.css';
import './index.css';
import App from './App.tsx';
import { useAuth } from './lib/auth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function Root() {
  const hydrate = useAuth((state) => state.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
