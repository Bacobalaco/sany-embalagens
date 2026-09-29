import PrintInterceptor from './PrintInterceptor';

export const metadata = { title: 'SANY Embalagens', description: 'Sistema financeiro da SANY Embalagens' };

export default function RootLayout({ children }) {
  return <html lang="pt-BR"><body><PrintInterceptor />{children}</body></html>;
}
