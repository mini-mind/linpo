import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import CollabPage from "./components/CollabPage";
import { Layout, RedirectToOverview } from "./components/Layout";
import { LoginPage } from "./components/LoginPage";
import { OverviewPage } from "./components/OverviewPage";
import SessionPage from "./components/SessionPage";
import { TopologyPage } from "./components/TopologyPage";
import { AuthProvider } from "./hooks/useAuth";
import { ToastProvider } from "./hooks/useToast";
import { ProtectedRoute, PublicRoute } from "./routes";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Root element not found");
}

function App(): JSX.Element {
	return (
		<AuthProvider>
			<ToastProvider>
				<BrowserRouter>
					<Routes>
						<Route element={<PublicRoute />}>
							<Route path="/login" element={<LoginPage />} />
						</Route>
						<Route element={<ProtectedRoute />}>
							<Route path="/" element={<Layout />}>
							<Route index element={<RedirectToOverview />} />
							<Route path="overview" element={<OverviewPage />} />
							<Route path="topology" element={<TopologyPage />} />
							<Route path="kanban" element={<CollabPage />} />
							<Route path="session" element={<SessionPage />} />
							<Route path="session/:instanceId" element={<SessionPage />} />
								<Route
									path="session/:instanceId/:agentId"
									element={<SessionPage />}
								/>
							<Route path="collab" element={<CollabPage />} />
							</Route>
						</Route>
						<Route path="*" element={<Navigate to="/login" replace />} />
					</Routes>
				</BrowserRouter>
			</ToastProvider>
		</AuthProvider>
	);
}

ReactDOM.createRoot(rootElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
