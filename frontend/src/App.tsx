import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { LoginPage } from "./pages/LoginPage";
import { ClientOverviewPage } from "./pages/client/ClientOverviewPage";
import { ClientSessionsPage } from "./pages/client/ClientSessionsPage";
import { ClientS3TesterPage } from "./pages/client/ClientS3TesterPage";
import { ClientGuidePage } from "./pages/client/ClientGuidePage";
import { AdminQueuePage } from "./pages/admin/AdminQueuePage";
import { AdminSessionsPage } from "./pages/admin/AdminSessionsPage";
import { AdminGraphPage } from "./pages/admin/AdminGraphPage";
import { AdminAuditPage } from "./pages/admin/AdminAuditPage";
import { AdminGuidePage } from "./pages/admin/AdminGuidePage";

function RequireAuth({
  children,
  adminOnly = false,
}: {
  children: ReactNode;
  adminOnly?: boolean;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="endfield-grid-bg font-mono-tech flex min-h-screen items-center justify-center text-xs tracking-widest text-[var(--text-muted)] uppercase">
        SYNCHRONIZING OPERATOR CREDENTIALS...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && user.role !== "admin") {
    return <Navigate to="/client" replace />;
  }

  return <>{children}</>;
}

function HomeRedirect() {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={user.role === "admin" ? "/admin" : "/client"} replace />;
}

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<LoginPage />} />

            {/* Separated Client / Operator Portal */}
            <Route
              path="/client"
              element={
                <RequireAuth>
                  <ClientOverviewPage />
                </RequireAuth>
              }
            />
            <Route
              path="/client/sessions"
              element={
                <RequireAuth>
                  <ClientSessionsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/client/s3-tester"
              element={
                <RequireAuth>
                  <ClientS3TesterPage />
                </RequireAuth>
              }
            />
            <Route
              path="/client/guide"
              element={
                <RequireAuth>
                  <ClientGuidePage />
                </RequireAuth>
              }
            />

            {/* Separated Admin / Commander Console */}
            <Route
              path="/admin"
              element={
                <RequireAuth adminOnly>
                  <AdminQueuePage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/sessions"
              element={
                <RequireAuth adminOnly>
                  <AdminSessionsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/graph"
              element={
                <RequireAuth adminOnly>
                  <AdminGraphPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/audit-log"
              element={
                <RequireAuth adminOnly>
                  <AdminAuditPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/guide"
              element={
                <RequireAuth adminOnly>
                  <AdminGuidePage />
                </RequireAuth>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
