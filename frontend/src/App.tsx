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
import { AdminOrgPage } from "./pages/admin/AdminOrgPage";
import { AdminRolesPage } from "./pages/admin/AdminRolesPage";
import { AdminSessionsPage } from "./pages/admin/AdminSessionsPage";
import { AdminGraphPage } from "./pages/admin/AdminGraphPage";
import { AdminAuditPage } from "./pages/admin/AdminAuditPage";
import { AdminGuidePage } from "./pages/admin/AdminGuidePage";
import { MasterPortalPage } from "./pages/master/MasterPortalPage";
import { ProfilePage } from "./pages/ProfilePage";
import type { UserRole } from "./types/api";

function homeForRole(role: UserRole): string {
  if (role === "platform_admin") return "/master";
  if (role === "admin") return "/admin";
  return "/client";
}

function RequireAuth({
  children,
  allowedRoles,
}: {
  children: ReactNode;
  allowedRoles?: UserRole[];
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

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={homeForRole(user.role)} replace />;
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

  return <Navigate to={homeForRole(user.role)} replace />;
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
                <RequireAuth allowedRoles={["requester", "admin"]}>
                  <ClientOverviewPage />
                </RequireAuth>
              }
            />
            <Route
              path="/client/sessions"
              element={
                <RequireAuth allowedRoles={["requester", "admin"]}>
                  <ClientSessionsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/client/tester"
              element={
                <RequireAuth allowedRoles={["requester", "admin"]}>
                  <ClientS3TesterPage />
                </RequireAuth>
              }
            />
            <Route
              path="/client/s3-tester"
              element={<Navigate to="/client/tester" replace />}
            />
            <Route
              path="/client/guide"
              element={
                <RequireAuth allowedRoles={["requester", "admin"]}>
                  <ClientGuidePage />
                </RequireAuth>
              }
            />
            <Route
              path="/client/profile"
              element={
                <RequireAuth allowedRoles={["requester", "admin"]}>
                  <ProfilePage portal="client" />
                </RequireAuth>
              }
            />

            {/* Separated Admin / Commander Console */}
            <Route
              path="/admin"
              element={
                <RequireAuth allowedRoles={["admin"]}>
                  <AdminQueuePage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/team"
              element={
                <RequireAuth allowedRoles={["admin"]}>
                  <AdminOrgPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/roles"
              element={
                <RequireAuth allowedRoles={["admin"]}>
                  <AdminRolesPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/sessions"
              element={
                <RequireAuth allowedRoles={["admin"]}>
                  <AdminSessionsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/graph"
              element={
                <RequireAuth allowedRoles={["admin"]}>
                  <AdminGraphPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/audit-log"
              element={
                <RequireAuth allowedRoles={["admin"]}>
                  <AdminAuditPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/guide"
              element={
                <RequireAuth allowedRoles={["admin"]}>
                  <AdminGuidePage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/profile"
              element={
                <RequireAuth allowedRoles={["admin"]}>
                  <ProfilePage portal="admin" />
                </RequireAuth>
              }
            />

            {/* Platform Master Admin Portal */}
            <Route
              path="/master"
              element={
                <RequireAuth allowedRoles={["platform_admin"]}>
                  <MasterPortalPage />
                </RequireAuth>
              }
            />
            <Route
              path="/master/profile"
              element={
                <RequireAuth allowedRoles={["platform_admin"]}>
                  <ProfilePage portal="master" />
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
