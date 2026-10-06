import { Component } from 'react';
import { DashboardProvider } from './context/DashboardContext';
import { CountryProvider } from './context/CountryContext';
import Dashboard from './pages/Dashboard';

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <main className="fatal-error"><h1>Unable to display the dashboard</h1>
      <button className="button primary" onClick={() => window.location.reload()}>Reload</button></main>;
    return this.props.children;
  }
}

export default function App() {
  return <ErrorBoundary><DashboardProvider><CountryProvider><Dashboard /></CountryProvider></DashboardProvider></ErrorBoundary>;
}
