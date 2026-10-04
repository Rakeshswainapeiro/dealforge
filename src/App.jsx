import './App.css'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { setupIframeMessaging } from './lib/iframe-messaging';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { filterPages, isPageEnabled } from '@/lib/features';

import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Login from '@/pages/Login';
import VerifyMemo from '@/pages/VerifyMemo';
import { LanguageProvider } from '@/lib/i18n';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

setupIframeMessaging();

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, features } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Unauthenticated: the session-backed login screen is the default entry.
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Public QR verification: a scanned memo opens here with no session. */}
        <Route path="/verify" element={<VerifyMemo />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  // Handle authentication errors
  if (authError && authError.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  // Render the main app, honouring the feature/menu configuration.
  const activePages = features ? filterPages(Pages, features) : Pages;
  const activeMainPage = mainPageKey && isPageEnabled(features || {}, mainPageKey) ? mainPageKey : Object.keys(activePages)[0];
  const ActiveMainPage = activeMainPage ? activePages[activeMainPage] : null;

  return (
    <LayoutWrapper currentPageName={activeMainPage || mainPageKey}>
      <Routes>
        <Route path="/" element={ActiveMainPage ? <ActiveMainPage /> : <PageNotFound />} />
        {/* Public verification also resolves for a signed-in scanner. */}
        <Route path="/verify" element={<VerifyMemo />} />
        {Object.entries(activePages).map(([path, Page]) => (
          <Route key={path} path={String('/' + path)} element={<Page />} />
        ))}
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </LayoutWrapper>
  );
};


function App() {

  return (
    <LanguageProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <NavigationTracker />
            <AuthenticatedApp />
          </Router>
          <Toaster />
          <VisualEditAgent />
        </QueryClientProvider>
      </AuthProvider>
    </LanguageProvider>
  )
}

export default App
