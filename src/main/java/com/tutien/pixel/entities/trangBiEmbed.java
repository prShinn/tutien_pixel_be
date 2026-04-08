package com.tutien.pixel.entities;

import jakarta.persistence.Embeddable;

@Embeddable
public class trangBiEmbed {
    private String vuKhi;
    private String ao;
    private String giay;
    private String mu;
    private String tay;
    private String nhan;
    private String vong;

    public String getVuKhi() {
        return vuKhi;
    }

    public void setVuKhi(String vuKhi) {
        this.vuKhi = vuKhi;
    }

    public String getAo() {
        return ao;
    }

    public void setAo(String ao) {
        this.ao = ao;
    }

    public String getGiay() {
        return giay;
    }

    public void setGiay(String giay) {
        this.giay = giay;
    }

    public String getMu() {
        return mu;
    }

    public void setMu(String mu) {
        this.mu = mu;
    }

    public String getTay() {
        return tay;
    }

    public void setTay(String tay) {
        this.tay = tay;
    }

    public String getNhan() {
        return nhan;
    }

    public void setNhan(String nhan) {
        this.nhan = nhan;
    }

    public String getVong() {
        return vong;
    }

    public void setVong(String vong) {
        this.vong = vong;
    }
}
