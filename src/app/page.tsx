import SupabaseBanner from "@/components/SupabaseBanner";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import ProductFeed from "@/components/ProductFeed";
import SellCTA from "@/components/SellCTA";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <SupabaseBanner />
      <Header />
      <main>
        <Hero />
        <ProductFeed />
        <SellCTA />
      </main>
      <Footer />
    </>
  );
}
