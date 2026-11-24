import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/auth/ProtectedRoute'
import { DEFAULT_PATH, EXTRA_ROUTES, NAV_ITEMS } from '@/config/nav'
import { AppShell } from '@/layout/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to={DEFAULT_PATH} replace />} />
          {NAV_ITEMS.map((item) => (
            <Route key={item.path} path={item.path} element={item.component ? <item.component /> : <PlaceholderPage item={item} />} />
          ))}
          {EXTRA_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<r.component />} />)}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
