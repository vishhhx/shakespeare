declare module "*.css" {
  const styles: Record<string, string>;
  export default styles;
}

declare global {
  namespace React {
    interface CSSProperties {
      [key: string]: any;
    }
  }
}

export {};
