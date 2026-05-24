import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: { destination: "/deployments", permanent: false },
  };
};

export default function HomePage() {
  return null;
}
