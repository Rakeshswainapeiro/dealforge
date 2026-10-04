import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { api } from '@/api/client';
import { normalizeFeatures } from '@/lib/features';


const AuthContext = createContext();

// Local auth: a single on-device user is always "signed in".
// The app simply resolves the current user and proceeds.
export const AuthProvider = ({ children }) => {
  const [appPublicSettings, setAppPublicSettings] = useState({ id: 'local', public_settings: {} });
  const [features, setFeatures] = useState(null);

  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);


  const checkAppState = useCallback(async () => {
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
      // Authentication is session-backed (Better Auth). Without a live session
      // the app shows the login screen rather than an implicit local user.
      const signedIn = await api.auth.isAuthenticated();
      if (!signedIn) {
        setUser(null);
        setIsAuthenticated(false);
        return;
      }
      const currentUser = await api.auth.me();
      if (!currentUser) {
        setUser(null);
        setIsAuthenticated(false);
        return;
      }
      setUser(currentUser);
      setIsAuthenticated(true);
    } catch (error) {
      console.error('Session check failed:', error);
      setAuthError({ type: 'unknown', message: error.message || 'Failed to resolve session user' });
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
      setIsLoadingPublicSettings(false);
    }
  }, []);

  // Sign in with email + password against Better Auth, then hydrate the actor.
  const login = useCallback(async (email, password) => {
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
      await api.auth.login(email, password);
      const currentUser = await api.auth.me();
      setUser(currentUser);
      setIsAuthenticated(!!currentUser);
      return currentUser;
    } catch (error) {
      setIsAuthenticated(false);
      setAuthError({ type: 'auth_required', message: error.message || 'Invalid email or password' });
      throw error;
    } finally {
      setIsLoadingAuth(false);
      setIsLoadingPublicSettings(false);
    }
  }, []);

  useEffect(() => {
    // Load the public (unauthenticated) app configuration once: feature flags + app name.
    (async () => {
      try {
        const pub = await api.auth.publicSettings();
        if (pub && pub.features) {
          setFeatures(normalizeFeatures(pub.features));
        }
        if (pub) setAppPublicSettings({ id: 'public', public_settings: { appName: pub.appName, features: pub.features } });
      } catch {
        setFeatures(null);
      } finally {
        setIsLoadingPublicSettings(false);
      }
    })();
    checkAppState();
  }, [checkAppState]);

  const logout = async (shouldRedirect = true) => {
    await api.auth.logout();
    setUser(null);
    setIsAuthenticated(false);
    if (shouldRedirect) {
      window.location.assign('/login');
    }
  };

  const navigateToLogin = () => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings,
        features,

        logout,
        login,
        navigateToLogin,
        checkAppState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
