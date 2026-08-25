import java.util.Date;

/** Thread consumidora do problema produtor-consumidor. */
public class Consumer implements Runnable {
    private Buffer buffer;

    public Consumer(Buffer b) {
        buffer = b;
    }

    public void run() {
        Date message;

        while (true) {
            System.out.println("Consumer napping");
            SleepUtilities.nap();
            System.out.println("Consumer wants to consume.");
            message = (Date) buffer.remove();
        }
    }
}
