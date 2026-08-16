import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api, getToken, clearToken } from './api.js';
import { Spinner } from './components/ui.jsx';
import AppLayout from './components/AppLayout.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Library from './pages/Library.jsx';
import ProcessDetail from './pages/ProcessDetail.jsx';
import Checklist from './pages/Checklist.jsx';
import Vault from './pages/Vault.jsx';
import Settings from './pages/Settings.jsx';
import Moderation from './pages/Moderation.jsx';

const AuthContext = createContext({ user: null, refresh: async () => {} });
export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { user: u } = await api('/api/auth/me');
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="መሬዳጃ" />
      </div>
    );
  }

  const isPublic = location.pathname.startsWith('/login');
  if (!user && !isPublic) return <Navigate to="/login" replace />;

  return (
    <AuthContext.Provider value={{ user, refresh, signOut: () => { clearToken(); setUser(null); } }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/processes" element={<Library />} />
          <Route path="/processes/:slug" element={<ProcessDetail />} />
          <Route path="/checklists/:id" element={<Checklist />} />
          <Route path="/vault" element={<Vault />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/moderation" element={<Moderation />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}
