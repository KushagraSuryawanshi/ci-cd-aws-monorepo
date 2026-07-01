import Image from "next/image";
import styles from "./page.module.css";

const services = [
  {
    name: "Next.js web",
    port: "3002",
    icon: "/window.svg",
    description: "The visible app surface for the deployment.",
  },
  {
    name: "HTTP API",
    port: "3000",
    icon: "/file-text.svg",
    description: "A simple Express service with a clear health response.",
  },
  {
    name: "WebSocket",
    port: "3001",
    icon: "/globe.svg",
    description: "A realtime service that confirms live connections.",
  },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="project-title">
        <div className={styles.copy}>
          <p className={styles.eyebrow}>CI/CD AWS Monorepo</p>
          <h1 id="project-title" className={styles.title}>
            Three services, one deployment pipeline.
          </h1>
          <p className={styles.subtitle}>
            A compact Turborepo project for deploying a Next.js web app,
            Express API, and WebSocket server through GitHub Actions onto AWS.
          </p>

          <div className={styles.flow} aria-label="Deployment flow">
            <span>GitHub Actions</span>
            <span>AWS</span>
            <span>PM2</span>
            <span>nginx</span>
          </div>
        </div>

        <div className={styles.services} aria-label="Service ports">
          {services.map((service) => (
            <article className={styles.service} key={service.name}>
              <div className={styles.serviceIcon}>
                <Image src={service.icon} alt="" width={24} height={24} />
              </div>
              <div>
                <h2>{service.name}</h2>
                <p>{service.description}</p>
              </div>
              <span className={styles.port}>:{service.port}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
