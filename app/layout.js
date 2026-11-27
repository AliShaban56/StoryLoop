import './globals.css';

export const metadata = { title: 'StoryLoop', description: 'لوحة تحكم StoryLoop' };

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
