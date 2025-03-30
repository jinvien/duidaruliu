import HomePage from './pages/HomePage.tsx';

import type { RouteProps } from 'react-router-dom';

const routers: RouteProps[] = [
  {
    path: '/',
    element: <HomePage />,
  },
  {
    path: '*',
    element: <HomePage />,
  },
];

export default routers;
